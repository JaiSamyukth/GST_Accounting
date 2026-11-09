import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { documents, purchases, returnPeriods, parties, salesDocs } from "../db/schema";
import { audit } from "./audit";
import type { SessionUser } from "./auth";
import { conflict, HttpError, notFound, unprocessable } from "./http";
import { getStorage, StorageUnavailableError } from "./storage";

export { MAX_FILE_BYTES as MAX_UPLOAD_BYTES } from "./limits";
import { MAX_FILE_BYTES, MAX_FILE_LABEL } from "./limits";
export const ENTITY_TYPES = ["sale", "purchase", "return", "party"] as const;
export const DOC_KINDS = ["bill_photo", "supplier_pdf", "acknowledgement", "other"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];
export type DocKind = (typeof DOC_KINDS)[number];

const TYPES = {
  pdf: { mime: "application/pdf", exts: ["pdf"], magic: [[0x25, 0x50, 0x44, 0x46, 0x2d]] },
  jpeg: { mime: "image/jpeg", exts: ["jpg", "jpeg"], magic: [[0xff, 0xd8, 0xff]] },
  png: { mime: "image/png", exts: ["png"], magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
} as const;

/** Check MIME, extension and magic bytes agree. Returns the canonical type. */
export function sniff(filename: string, declaredMime: string, bytes: Uint8Array): { mime: string; ext: string } {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  for (const t of Object.values(TYPES)) {
    if (!(t.exts as readonly string[]).includes(ext)) continue;
    if (declaredMime && declaredMime !== t.mime && !(t.mime === "image/jpeg" && declaredMime === "image/jpg")) {
      throw unprocessable("File type does not match its extension");
    }
    const ok = t.magic.some((m) => m.every((b, i) => bytes[i] === b));
    if (!ok) throw unprocessable("File contents do not look like a " + ext.toUpperCase());
    return { mime: t.mime, ext: t.exts[0] };
  }
  throw unprocessable("Only PDF, JPEG and PNG files can be attached");
}

async function assertEntity(db: Db, type: EntityType, id: string): Promise<void> {
  const n = Number(id);
  let found = false;
  if (type === "return") {
    found = !!(await db.select({ id: returnPeriods.id }).from(returnPeriods).where(eq(returnPeriods.period, id)).limit(1))[0];
  } else if (Number.isSafeInteger(n) && n > 0) {
    const table = type === "sale" ? salesDocs : type === "purchase" ? purchases : parties;
    found = !!(await db.select({ id: table.id }).from(table).where(eq(table.id, n)).limit(1))[0];
  }
  if (!found) throw notFound(`That ${type} does not exist`);
}

export async function listDocuments(db: Db, type: EntityType, id: string) {
  return db.select().from(documents).where(and(eq(documents.entityType, type), eq(documents.entityId, id))).orderBy(desc(documents.createdAt));
}

export async function uploadDocument(
  db: Db, user: SessionUser,
  input: { entityType: EntityType; entityId: string; kind: DocKind; filename: string; mime: string; bytes: Uint8Array },
) {
  if (input.bytes.byteLength === 0) throw unprocessable("The file is empty");
  if (input.bytes.byteLength > MAX_FILE_BYTES) throw new HttpError(413, `File is larger than ${MAX_FILE_LABEL}`);
  const t = sniff(input.filename, input.mime, input.bytes);
  await assertEntity(db, input.entityType, input.entityId);
  const checksum = createHash("sha256").update(input.bytes).digest("hex");
  const dup = await db.select({ id: documents.id }).from(documents)
    .where(and(eq(documents.entityType, input.entityType), eq(documents.entityId, input.entityId), eq(documents.checksum, checksum))).limit(1);
  if (dup.length) throw conflict("This file is already attached here");
  const key = `${input.entityType}/${input.entityId}/${randomUUID()}.${t.ext}`;
  try {
    await getStorage().put(key, input.bytes, t.mime);
  } catch (e) {
    if (e instanceof StorageUnavailableError) throw new HttpError(503, e.message);
    console.error(e);
    throw new HttpError(503, "File storage is unavailable. Try again later.");
  }
  const [row] = await db.insert(documents).values({
    entityType: input.entityType, entityId: input.entityId, kind: input.kind,
    filename: input.filename.slice(0, 200), mimeType: t.mime, sizeBytes: input.bytes.byteLength,
    objectKey: key, checksum, uploadedBy: user.id,
  }).returning();
  await audit(db, user, { action: "upload", entityType: "document", entityId: row.id, summary: `${row.filename} on ${row.entityType} ${row.entityId}` });
  return row;
}

export async function getDocument(db: Db, id: number) {
  const row = (await db.select().from(documents).where(eq(documents.id, id)).limit(1))[0];
  if (!row) throw notFound("Attachment not found");
  return row;
}

export async function readDocumentFile(db: Db, id: number) {
  const row = await getDocument(db, id);
  let bytes: Uint8Array | null;
  try {
    bytes = await getStorage().get(row.objectKey);
  } catch (e) {
    if (e instanceof StorageUnavailableError) throw new HttpError(503, e.message);
    throw new HttpError(503, "File storage is unavailable. Try again later.");
  }
  if (!bytes) throw notFound("The file is unavailable in storage");
  return { row, bytes };
}

export async function deleteDocument(db: Db, user: SessionUser, id: number) {
  const row = await getDocument(db, id);
  try {
    await getStorage().delete(row.objectKey);
  } catch (e) {
    if (e instanceof StorageUnavailableError) throw new HttpError(503, e.message);
    throw new HttpError(503, "File storage is unavailable. Try again later.");
  }
  await db.delete(documents).where(eq(documents.id, id));
  await audit(db, user, { action: "delete", entityType: "document", entityId: id, summary: `${row.filename} on ${row.entityType} ${row.entityId}`, before: row });
}

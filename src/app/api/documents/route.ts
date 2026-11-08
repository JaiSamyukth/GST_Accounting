import { z } from "zod";
import { DOC_KINDS, ENTITY_TYPES, listDocuments, MAX_UPLOAD_BYTES, uploadDocument } from "@/lib/attachments";
import { HttpError, json, unprocessable } from "@/lib/http";
import { MAX_FILE_LABEL } from "@/lib/limits";
import { route } from "@/lib/route";

const listSchema = z.object({ entity_type: z.enum(ENTITY_TYPES), entity_id: z.string().min(1).max(40) });
const uploadSchema = z.object({ entity_type: z.enum(ENTITY_TYPES), entity_id: z.string().min(1).max(40), kind: z.enum(DOC_KINDS).default("other") });

export const GET = route({}, async ({ req, db }) => {
  const sp = new URL(req.url).searchParams;
  const q = listSchema.parse({ entity_type: sp.get("entity_type"), entity_id: sp.get("entity_id") });
  return { documents: await listDocuments(db, q.entity_type, q.entity_id) };
});

export const POST = route({}, async ({ req, db, user }) => {
  // Reject early from Content-Length before buffering the body.
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD_BYTES + 64 * 1024) throw new HttpError(413, `File is larger than ${MAX_FILE_LABEL}`);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw unprocessable("Send the file as multipart/form-data");
  }
  const meta = uploadSchema.parse({ entity_type: form.get("entity_type"), entity_id: form.get("entity_id"), kind: form.get("kind") || undefined });
  const file = form.get("file");
  if (!(file instanceof File)) throw unprocessable("Choose a file to upload");
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, `File is larger than ${MAX_FILE_LABEL}`);
  const row = await uploadDocument(db, user, {
    entityType: meta.entity_type, entityId: meta.entity_id, kind: meta.kind,
    filename: file.name || "upload", mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()),
  });
  return json({ document: row }, 201);
});

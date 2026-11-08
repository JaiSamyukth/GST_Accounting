import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db, Tx } from "../db/client";
import { hsnCodes, importBatches, parties, purchases, returnPeriods, salesDocs } from "../db/schema";
import { audit } from "./audit";
import type { SessionUser } from "./auth";
import { insertPurchase, insertSale } from "./docs";
import { toCsv } from "./export/csv";
import { autoMap, KINDS, validateTable, type ImportKind, type Mapping, type RowError } from "./gst/importers";
import { periodOf } from "./gst/periods";
import { readTable, TableError, type RawTable } from "./gst/tabular";
import { conflict, notFound, unprocessable } from "./http";
import { assertUnlocked } from "./locks";
import { ensurePeriod } from "./returns-service";
import { getBusiness } from "./settings";

export const PREVIEW_ROWS = 300;

export async function loadTable(bytes: Uint8Array, filename: string): Promise<RawTable> {
  try {
    return await readTable(bytes, filename);
  } catch (e) {
    if (e instanceof TableError) throw unprocessable(e.message);
    throw e;
  }
}

/** Validate the file and check it against the database. Writes nothing. */
export async function analyse(db: Tx, kind: ImportKind, table: RawTable, mappingIn?: Mapping) {
  const biz = await getBusiness(db);
  const mapping = { ...autoMap(kind, table.headers), ...(mappingIn ?? {}) };
  const v = validateTable(kind, table, mapping, { businessState: biz.stateCode });
  const extra: RowError[] = [];
  const reject = (rows: number[], message: string) => rows.forEach((row) => extra.push({ row, message }));

  // Database checks: duplicates and locked periods.
  const locked = new Set((await db.select({ p: returnPeriods.period }).from(returnPeriods).where(eq(returnPeriods.locked, true))).map((r) => r.p));
  const ok = [];
  for (const g of v.records) {
    const r = g.record;
    let bad: string | null = null;
    if (r.type === "sale") {
      if (locked.has(periodOf(r.input.date, biz.filingFrequency))) bad = `Period ${periodOf(r.input.date, biz.filingFrequency)} is locked`;
      else if ((await db.select({ id: salesDocs.id }).from(salesDocs).where(and(eq(salesDocs.docType, r.input.docType), eq(salesDocs.number, r.input.number!))).limit(1)).length) bad = `Number ${r.input.number} already exists`;
    } else if (r.type === "purchase") {
      if (locked.has(periodOf(r.input.date, biz.filingFrequency))) bad = `Period ${periodOf(r.input.date, biz.filingFrequency)} is locked`;
      else if ((await db.select({ id: purchases.id }).from(purchases).where(and(eq(purchases.supplierGstin, r.input.supplierGstin), eq(purchases.supplierName, r.input.supplierName), eq(purchases.number, r.input.number), eq(purchases.docType, r.input.docType))).limit(1)).length) bad = `Bill ${r.input.number} from ${r.input.supplierName} already exists`;
    } else if (r.type === "party") {
      if ((await db.select({ id: parties.id }).from(parties).where(and(eq(parties.kind, r.input.kind), eq(parties.name, r.input.name), eq(parties.gstin, r.input.gstin))).limit(1)).length) bad = `${r.input.name} already exists`;
    } else if (r.type === "hsn") {
      if ((await db.select({ id: hsnCodes.id }).from(hsnCodes).where(eq(hsnCodes.code, r.input.code)).limit(1)).length) bad = `Code ${r.input.code} already exists`;
    } else if (r.type === "payment") {
      if (locked.has(r.input.period)) bad = `Period ${r.input.period} is locked`;
    }
    if (bad) reject(g.rows, bad);
    else ok.push(g);
  }
  const errors = [...v.errors, ...extra].sort((a, b) => a.row - b.row);
  const errorRows = new Set(errors.map((e) => e.row));
  return { mapping, records: ok, errors, errorRows, table };
}

export function previewResponse(kind: ImportKind, a: Awaited<ReturnType<typeof analyse>>) {
  const errByRow = new Map<number, string[]>();
  for (const e of a.errors) errByRow.set(e.row, [...(errByRow.get(e.row) ?? []), e.message]);
  return {
    kind,
    fields: KINDS[kind].fields,
    headers: a.table.headers,
    mapping: a.mapping,
    totalRows: a.table.rows.length,
    validRows: a.records.reduce((s, g) => s + g.rows.length, 0),
    errorRows: [...a.errorRows].filter((r) => r > 1).length,
    fileErrors: a.errors.filter((e) => e.row === 1).map((e) => e.message),
    documents: a.records.map((g) => ({ label: g.label, rows: g.rows })).slice(0, PREVIEW_ROWS),
    documentCount: a.records.length,
    rows: a.table.rows.slice(0, PREVIEW_ROWS).map((cells, i) => ({ row: i + 2, cells, errors: errByRow.get(i + 2) ?? [] })),
  };
}

export function errorReportCsv(a: Awaited<ReturnType<typeof analyse>>): string {
  const byRow = new Map<number, string[]>();
  for (const e of a.errors) byRow.set(e.row, [...(byRow.get(e.row) ?? []), e.message]);
  const columns = [{ key: "_row", label: "Row" }, ...a.table.headers.map((h, i) => ({ key: `c${i}`, label: h || `Column ${i + 1}` })), { key: "_errors", label: "Errors" }];
  const rows = [...byRow.entries()].sort((x, y) => x[0] - y[0]).map(([row, msgs]) => {
    const cells = row >= 2 ? a.table.rows[row - 2] : [];
    return { _row: row, ...Object.fromEntries(cells.map((c, i) => [`c${i}`, c])), _errors: msgs.join("; ") };
  });
  return toCsv({ title: "Import errors", columns, rows });
}

interface CreatedIds {
  sales: number[];
  purchases: number[];
  parties: number[];
  hsn: number[];
  payments: Array<{ period: string; before: Record<string, number | string | null> }>;
}

/** Create every valid record in one transaction. Invalid rows are skipped and counted. */
export async function commitImport(db: Db, user: SessionUser, kind: ImportKind, filename: string, a: Awaited<ReturnType<typeof analyse>>) {
  if (a.errors.some((e) => e.row === 1)) throw unprocessable(a.errors.find((e) => e.row === 1)!.message);
  if (!a.records.length) throw unprocessable("No valid rows to import");
  return db.transaction(async (tx) => {
    const [batch] = await tx.insert(importBatches).values({
      kind, filename: filename.slice(0, 200), status: "committed", totalRows: a.table.rows.length,
      validRows: a.records.reduce((s, g) => s + g.rows.length, 0), errorRows: [...a.errorRows].filter((r) => r > 1).length,
      mapping: a.mapping, errors: a.errors.slice(0, 1000), createdBy: user.id,
    }).returning();
    const created: CreatedIds = { sales: [], purchases: [], parties: [], hsn: [], payments: [] };
    for (const g of a.records) {
      const r = g.record;
      if (r.type === "sale") created.sales.push((await insertSale(tx, user, r.input, { importBatchId: batch.id })).id);
      else if (r.type === "purchase") created.purchases.push((await insertPurchase(tx, user, r.input, batch.id)).id);
      else if (r.type === "party") created.parties.push((await tx.insert(parties).values(r.input).returning({ id: parties.id }))[0].id);
      else if (r.type === "hsn") created.hsn.push((await tx.insert(hsnCodes).values(r.input).returning({ id: hsnCodes.id }))[0].id);
      else {
        const before = await ensurePeriod(tx, r.input.period);
        if (before.locked) throw conflict(`Period ${r.input.period} is locked`);
        created.payments.push({
          period: r.input.period,
          before: { paidIgst: before.paidIgst, paidCgst: before.paidCgst, paidSgst: before.paidSgst, paidCess: before.paidCess, interest: before.interest, lateFee: before.lateFee, challanRef: before.challanRef, paidOn: before.paidOn },
        });
        await tx.update(returnPeriods).set({ ...r.input, updatedAt: new Date() }).where(eq(returnPeriods.period, r.input.period));
      }
    }
    const [done] = await tx.update(importBatches).set({ createdIds: created }).where(eq(importBatches.id, batch.id)).returning();
    await audit(tx, user, { action: "import", entityType: "import_batch", entityId: batch.id, summary: `${kind}: ${a.records.length} record(s) from ${filename}` });
    return done;
  });
}

export async function listBatches(db: Tx) {
  return db.select({
    id: importBatches.id, kind: importBatches.kind, filename: importBatches.filename, status: importBatches.status,
    totalRows: importBatches.totalRows, validRows: importBatches.validRows, errorRows: importBatches.errorRows,
    createdAt: importBatches.createdAt, rolledBackAt: importBatches.rolledBackAt,
  }).from(importBatches).orderBy(desc(importBatches.id)).limit(100);
}

/** Undo: delete exactly what the batch created. Refuses when a period involved is locked. */
export async function rollbackImport(db: Db, user: SessionUser, id: number) {
  return db.transaction(async (tx) => {
    const batch = (await tx.select().from(importBatches).where(eq(importBatches.id, id)).limit(1))[0];
    if (!batch) throw notFound("Import not found");
    if (batch.status === "rolled_back") throw conflict("This import was already undone");
    const c = (batch.createdIds ?? { sales: [], purchases: [], parties: [], hsn: [], payments: [] }) as CreatedIds;
    const biz = await getBusiness(tx);

    if (c.sales.length) {
      const docs = await tx.select().from(salesDocs).where(inArray(salesDocs.id, c.sales));
      if (docs.some((d) => d.amendedById)) throw conflict("Some imported documents have been amended since; cancel the amendments first");
      await assertUnlocked(tx, biz.filingFrequency, { dates: docs.map((d) => d.date) });
      await tx.delete(salesDocs).where(inArray(salesDocs.id, c.sales));
    }
    if (c.purchases.length) {
      const docs = await tx.select().from(purchases).where(inArray(purchases.id, c.purchases));
      await assertUnlocked(tx, biz.filingFrequency, { dates: docs.map((d) => d.date), periods: docs.map((d) => d.itcPeriod) });
      await tx.delete(purchases).where(inArray(purchases.id, c.purchases));
    }
    if (c.parties.length) {
      const used = await tx.select({ id: salesDocs.id }).from(salesDocs).where(inArray(salesDocs.partyId, c.parties)).limit(1);
      const usedP = await tx.select({ id: purchases.id }).from(purchases).where(inArray(purchases.supplierId, c.parties)).limit(1);
      if (used.length || usedP.length) throw conflict("Some imported parties are used on sales or purchases; they cannot be removed");
      await tx.delete(parties).where(inArray(parties.id, c.parties));
    }
    if (c.hsn.length) await tx.delete(hsnCodes).where(inArray(hsnCodes.id, c.hsn));
    if (c.payments.length) {
      await assertUnlocked(tx, biz.filingFrequency, { periods: c.payments.map((p) => p.period) });
      for (const p of c.payments) {
        await tx.update(returnPeriods).set({ ...(p.before as Partial<typeof returnPeriods.$inferInsert>), updatedAt: new Date() }).where(eq(returnPeriods.period, p.period));
      }
    }
    const [after] = await tx.update(importBatches).set({ status: "rolled_back", rolledBackAt: new Date() })
      .where(eq(importBatches.id, id)).returning();
    await audit(tx, user, { action: "rollback", entityType: "import_batch", entityId: id, summary: `Undid ${batch.kind} import ${batch.filename}` });
    return after;
  });
}

/** Read the multipart body shared by preview, error-report and commit. */
export async function readImportForm(req: Request) {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 21 * 1024 * 1024) throw unprocessable("The file is larger than 20 MB");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw unprocessable("Send the file as multipart/form-data");
  }
  const kind = String(form.get("kind") ?? "");
  if (!(kind in KINDS)) throw unprocessable("Choose what you are importing");
  const file = form.get("file");
  if (!(file instanceof File)) throw unprocessable("Choose a file to upload");
  let mapping: Mapping | undefined;
  const m = form.get("mapping");
  if (typeof m === "string" && m) {
    try {
      const parsed: unknown = JSON.parse(m);
      if (parsed && typeof parsed === "object") {
        mapping = Object.fromEntries(Object.entries(parsed).filter(([, v]) => Number.isInteger(v)).map(([k, v]) => [k, Number(v)]));
      }
    } catch {
      throw unprocessable("Column mapping is not valid JSON");
    }
  }
  const table = await loadTable(new Uint8Array(await file.arrayBuffer()), file.name);
  return { kind: kind as ImportKind, filename: file.name, table, mapping };
}

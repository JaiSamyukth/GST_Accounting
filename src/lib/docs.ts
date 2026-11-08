import { and, asc, desc, eq, gte, ilike, inArray, isNull, like, lte, or, sql, type SQL } from "drizzle-orm";
import type { Db, Tx } from "../db/client";
import { purchaseLines, purchases, salesDocs, salesLines } from "../db/schema";
import { audit } from "./audit";
import type { SessionUser } from "./auth";
import {
  PURCHASE_CATEGORIES, toEngineLine, type PurchaseInput, type SaleInput,
} from "./docs-input";
import { calcDocument, classifySalesDoc, isIntraState, type DocumentResult } from "./gst/gst";
import { periodOf, periodRange } from "./gst/periods";
import { BLOCKED_REASON } from "./gst/returns";
import { conflict, notFound, unprocessable } from "./http";
import { assertUnlocked } from "./locks";
import { formatScaled, parseScaled } from "./money";
import { getBusiness, type Business } from "./settings";

export type SalesDoc = typeof salesDocs.$inferSelect;
export type SalesLine = typeof salesLines.$inferSelect;
export type Purchase = typeof purchases.$inferSelect;
export type PurchaseLine = typeof purchaseLines.$inferSelect;

// ---- sales -----------------------------------------------------------------

export function computeSale(input: SaleInput, biz: Business): { calc: DocumentResult; section: string; pos: string } {
  const pos = input.isExport ? "96" : input.placeOfSupply;
  const calc = calcDocument(input.lines.map(toEngineLine), {
    intraState: isIntraState(pos, biz.stateCode, input.isExport),
    priceMode: input.priceMode,
    isExport: input.isExport,
    exportWithIgst: input.exportWithIgst,
    roundOff: biz.roundOff,
  });
  const section = classifySalesDoc({
    docType: input.docType,
    partyGstin: input.partyGstin || null,
    placeOfSupply: pos,
    businessState: biz.stateCode,
    isExport: input.isExport,
    invoiceValue: calc.grandTotal,
    b2clLimit: biz.b2clLimit,
  });
  return { calc, section, pos };
}

const NOTE_PREFIX = { invoice: "", credit_note: "CN-", debit_note: "DN-" } as const;

export async function nextSalesNumber(db: Tx, docType: SaleInput["docType"]): Promise<string> {
  const biz = await getBusiness(db);
  const prefix = docType === "invoice" ? biz.invoicePrefix : NOTE_PREFIX[docType];
  const rows = await db
    .select({ number: salesDocs.number })
    .from(salesDocs)
    .where(and(eq(salesDocs.docType, docType), like(salesDocs.number, `${prefix.replace(/[%_]/g, "\\$&")}%`)));
  let max = 0;
  for (const r of rows) {
    const m = /(\d+)$/.exec(r.number.slice(prefix.length));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

function saleValues(input: SaleInput, calc: DocumentResult, section: string, pos: string) {
  return {
    docType: input.docType,
    date: input.date,
    partyId: input.partyId,
    partyName: input.partyName,
    partyGstin: input.partyGstin,
    partyAddress: input.partyAddress,
    partyStateCode: input.partyGstin ? input.partyGstin.slice(0, 2) : pos,
    placeOfSupply: pos,
    reverseCharge: input.reverseCharge,
    priceMode: input.priceMode,
    taxableValue: calc.taxableValue,
    cgst: calc.cgst,
    sgst: calc.sgst,
    igst: calc.igst,
    cess: calc.cess,
    total: calc.total,
    roundOff: calc.roundOff,
    grandTotal: calc.grandTotal,
    notes: input.notes,
    originalNumber: input.docType === "invoice" ? "" : input.originalNumber,
    originalDate: input.docType === "invoice" ? null : input.originalDate,
    noteReason: input.docType === "invoice" ? "" : input.noteReason,
    isExport: input.isExport,
    exportWithIgst: input.isExport && input.exportWithIgst,
    section,
    orderRef: input.orderRef,
  };
}

function lineRows(calc: DocumentResult) {
  return calc.lines.map((l, i) => ({
    position: i + 1,
    description: l.description,
    hsnSac: l.hsnSac,
    qty: formatScaled(l.qtyMilli, 3),
    unit: l.unit,
    unitPrice: formatScaled(l.unitPriceE4, 4),
    discount: l.discount,
    gstRateBp: l.gstRateBp,
    cessRateBp: l.cessRateBp,
    supplyKind: l.supplyKind,
    taxableValue: l.taxableValue,
    cgst: l.cgst,
    sgst: l.sgst,
    igst: l.igst,
    cess: l.cess,
    total: l.total,
  }));
}

export async function getSale(db: Tx, id: number): Promise<{ doc: SalesDoc; lines: SalesLine[] }> {
  const doc = (await db.select().from(salesDocs).where(eq(salesDocs.id, id)).limit(1))[0];
  if (!doc) throw notFound("Sale not found");
  const lines = await db.select().from(salesLines).where(eq(salesLines.docId, id)).orderBy(asc(salesLines.position));
  return { doc, lines };
}

export interface InsertOpts {
  importBatchId?: number;
  /** Amendment rows: lock is checked on these periods instead of the document date. */
  lockPeriods?: string[];
  amendsId?: number;
  amendPeriod?: string;
  number?: string;
}

/** Insert a sale inside an existing transaction (used by create, import and amend). */
export async function insertSale(tx: Tx, user: SessionUser, input: SaleInput, opts: InsertOpts = {}) {
  const biz = await getBusiness(tx);
  if (opts.lockPeriods) await assertUnlocked(tx, biz.filingFrequency, { periods: opts.lockPeriods });
  else await assertUnlocked(tx, biz.filingFrequency, { dates: [input.date] });
  const { calc, section, pos } = computeSale(input, biz);
  const number = opts.number ?? input.number ?? (await nextSalesNumber(tx, input.docType));
  const exists = await tx.select({ id: salesDocs.id }).from(salesDocs)
    .where(and(eq(salesDocs.docType, input.docType), eq(salesDocs.number, number))).limit(1);
  if (exists[0]) throw conflict(`Number ${number} is already used`);
  const [doc] = await tx.insert(salesDocs).values({
    ...saleValues(input, calc, section, pos), number,
    importBatchId: opts.importBatchId ?? null, amendsId: opts.amendsId ?? null, amendPeriod: opts.amendPeriod ?? null,
  }).returning();
  await tx.insert(salesLines).values(lineRows(calc).map((l) => ({ ...l, docId: doc.id })));
  await audit(tx, user, {
    action: opts.amendsId ? "amend" : opts.importBatchId ? "import" : "create",
    entityType: "sale", entityId: doc.id, summary: `${doc.docType} ${doc.number}`, after: doc,
  });
  return doc;
}

export async function createSale(db: Db, user: SessionUser, input: SaleInput) {
  return db.transaction((tx) => insertSale(tx, user, input));
}

export async function updateSale(db: Db, user: SessionUser, id: number, input: SaleInput) {
  return db.transaction(async (tx) => {
    const biz = await getBusiness(tx);
    const before = await getSale(tx, id);
    if (before.doc.status === "cancelled") throw conflict("A cancelled document cannot be edited");
    if (before.doc.amendedById) throw conflict("This document has been amended. Open the amendment to make changes.");
    if (input.docType !== before.doc.docType) throw unprocessable("The document type cannot be changed");
    if (before.doc.amendsId) await assertUnlocked(tx, biz.filingFrequency, { periods: [before.doc.amendPeriod] });
    else await assertUnlocked(tx, biz.filingFrequency, { dates: [before.doc.date, input.date] });
    const { calc, section, pos } = computeSale(input, biz);
    if (before.doc.amendsId && section !== before.doc.section) {
      throw unprocessable(`This change would move the amendment to section ${section.toUpperCase()}. Issue a credit note and a new invoice instead.`);
    }
    // An amendment keeps its number: the portal number cannot be amended.
    const number = before.doc.amendsId ? before.doc.number : input.number ?? before.doc.number;
    if (number !== before.doc.number) {
      const exists = await tx.select({ id: salesDocs.id }).from(salesDocs)
        .where(and(eq(salesDocs.docType, input.docType), eq(salesDocs.number, number))).limit(1);
      if (exists[0]) throw conflict(`Number ${number} is already used`);
    }
    const [doc] = await tx.update(salesDocs)
      .set({ ...saleValues(input, calc, section, pos), number, updatedAt: new Date() })
      .where(eq(salesDocs.id, id)).returning();
    await tx.delete(salesLines).where(eq(salesLines.docId, id));
    await tx.insert(salesLines).values(lineRows(calc).map((l) => ({ ...l, docId: id })));
    await audit(tx, user, { action: "update", entityType: "sale", entityId: id, summary: `${doc.docType} ${doc.number}`, before: before.doc, after: doc });
    return doc;
  });
}

export async function cancelSale(db: Db, user: SessionUser, id: number, reason: string) {
  return db.transaction(async (tx) => {
    const biz = await getBusiness(tx);
    const { doc } = await getSale(tx, id);
    if (doc.status === "cancelled") throw conflict("Already cancelled");
    if (doc.amendedById) throw conflict("This document has been amended. Cancel the amendment first.");
    if (doc.amendsId) {
      // Withdrawing an amendment makes the previous version current again.
      await assertUnlocked(tx, biz.filingFrequency, { periods: [doc.amendPeriod] });
      await tx.update(salesDocs).set({ amendedById: null, updatedAt: new Date() }).where(eq(salesDocs.id, doc.amendsId));
    } else {
      await assertUnlocked(tx, biz.filingFrequency, { dates: [doc.date] });
    }
    const notes = [doc.notes, `Cancelled: ${reason}`].filter(Boolean).join("\n");
    const [after] = await tx.update(salesDocs).set({ status: "cancelled", notes, updatedAt: new Date() })
      .where(eq(salesDocs.id, id)).returning();
    await audit(tx, user, { action: "cancel", entityType: "sale", entityId: id, summary: `${doc.docType} ${doc.number}: ${reason}`, before: doc, after });
    return after;
  });
}

export interface ListFilter {
  from?: string;
  to?: string;
  period?: string;
  docType?: string;
  status?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

function dateRange(f: ListFilter): { from?: string; to?: string } {
  if (f.period) {
    const r = periodRange(f.period);
    return { from: r.from, to: r.to };
  }
  return { from: f.from, to: f.to };
}

export async function listSales(db: Tx, f: ListFilter & { section?: string }) {
  const { from, to } = dateRange(f);
  const where: SQL[] = [];
  if (from) where.push(gte(salesDocs.date, from));
  if (to) where.push(lte(salesDocs.date, to));
  if (f.docType) where.push(eq(salesDocs.docType, f.docType as SalesDoc["docType"]));
  if (f.section) where.push(eq(salesDocs.section, f.section));
  if (f.status) where.push(eq(salesDocs.status, f.status as SalesDoc["status"]));
  if (f.q) {
    const q = `%${f.q.replace(/[%_]/g, "\\$&")}%`;
    where.push(or(ilike(salesDocs.number, q), ilike(salesDocs.partyName, q), ilike(salesDocs.partyGstin, q))!);
  }
  const cond = where.length ? and(...where) : undefined;
  const pageSize = Math.min(Math.max(f.pageSize ?? 50, 1), 500);
  const page = Math.max(f.page ?? 1, 1);
  const rows = await db.select().from(salesDocs).where(cond)
    .orderBy(desc(salesDocs.date), desc(salesDocs.id)).limit(pageSize).offset((page - 1) * pageSize);
  // Totals sign credit notes negative and skip cancelled and superseded (amended) documents.
  const sign = sql`case when ${salesDocs.docType} = 'credit_note' then -1 else 1 end`;
  const active = sql`case when ${salesDocs.status} = 'active' and ${salesDocs.amendedById} is null then 1 else 0 end`;
  const [t] = await db.select({
    count: sql<number>`count(*)::int`,
    taxableValue: sql<number>`coalesce(sum(${salesDocs.taxableValue} * ${sign} * ${active}), 0)::bigint`,
    tax: sql<number>`coalesce(sum((${salesDocs.cgst} + ${salesDocs.sgst} + ${salesDocs.igst} + ${salesDocs.cess}) * ${sign} * ${active}), 0)::bigint`,
    grandTotal: sql<number>`coalesce(sum(${salesDocs.grandTotal} * ${sign} * ${active}), 0)::bigint`,
  }).from(salesDocs).where(cond);
  return {
    rows,
    total: Number(t.count),
    page,
    pageSize,
    totals: { taxableValue: Number(t.taxableValue), tax: Number(t.tax), grandTotal: Number(t.grandTotal) },
  };
}

// ---- purchases ---------------------------------------------------------------

export function computePurchase(input: PurchaseInput, biz: Business) {
  const pos = input.placeOfSupply ?? biz.stateCode;
  const calc = calcDocument(input.lines.map(toEngineLine), {
    intraState: input.supplierStateCode === pos,
    priceMode: input.priceMode,
    roundOff: false,
  });
  const blocked = PURCHASE_CATEGORIES[input.category].blocked;
  const eligibility = input.lines.map((l) => {
    if (biz.noItcScheme) return { itcEligible: false, itcReason: "Business pays GST without ITC" };
    if (!input.supplierGstin) return { itcEligible: false, itcReason: "Supplier is unregistered" };
    if (blocked) return { itcEligible: false, itcReason: BLOCKED_REASON };
    return { itcEligible: l.itcEligible, itcReason: l.itcEligible ? "" : l.itcReason || "Marked ineligible" };
  });
  let itcTotal = 0;
  calc.lines.forEach((l, i) => {
    if (eligibility[i].itcEligible) itcTotal += l.cgst + l.sgst + l.igst + l.cess;
  });
  const itcPeriod = input.itcPeriod ?? periodOf(input.date, biz.filingFrequency);
  if (periodRange(itcPeriod).to < input.date) throw unprocessable("ITC period cannot be before the bill date");
  return { calc, eligibility, itcTotal, pos, itcPeriod };
}

export async function getPurchase(db: Tx, id: number): Promise<{ doc: Purchase; lines: PurchaseLine[] }> {
  const doc = (await db.select().from(purchases).where(eq(purchases.id, id)).limit(1))[0];
  if (!doc) throw notFound("Purchase not found");
  const lines = await db.select().from(purchaseLines).where(eq(purchaseLines.docId, id)).orderBy(asc(purchaseLines.position));
  return { doc, lines };
}

function purchaseValues(input: PurchaseInput, c: ReturnType<typeof computePurchase>) {
  return {
    docType: input.docType,
    number: input.number,
    date: input.date,
    supplierId: input.supplierId,
    supplierName: input.supplierName,
    supplierGstin: input.supplierGstin,
    supplierStateCode: input.supplierStateCode,
    placeOfSupply: c.pos,
    reverseCharge: input.reverseCharge,
    priceMode: input.priceMode,
    taxableValue: c.calc.taxableValue,
    cgst: c.calc.cgst,
    sgst: c.calc.sgst,
    igst: c.calc.igst,
    cess: c.calc.cess,
    total: c.calc.total,
    roundOff: 0,
    grandTotal: c.calc.grandTotal,
    itcTotal: c.itcTotal,
    category: input.category,
    itcPeriod: c.itcPeriod,
    notes: input.notes,
    originalNumber: input.docType === "invoice" ? "" : input.originalNumber,
  };
}

async function assertPurchaseUnique(tx: Tx, input: PurchaseInput, exceptId?: number) {
  const rows = await tx.select({ id: purchases.id }).from(purchases).where(and(
    eq(purchases.supplierGstin, input.supplierGstin), eq(purchases.supplierName, input.supplierName),
    eq(purchases.number, input.number), eq(purchases.docType, input.docType),
  )).limit(2);
  if (rows.some((r) => r.id !== exceptId)) throw conflict(`Bill ${input.number} from ${input.supplierName} is already entered`);
}

/** Insert a purchase inside an existing transaction (used by create and import). */
export async function insertPurchase(tx: Tx, user: SessionUser, input: PurchaseInput, importBatchId?: number) {
  const biz = await getBusiness(tx);
  const c = computePurchase(input, biz);
  await assertUnlocked(tx, biz.filingFrequency, { dates: [input.date], periods: [c.itcPeriod] });
  await assertPurchaseUnique(tx, input);
  const [doc] = await tx.insert(purchases).values({ ...purchaseValues(input, c), importBatchId: importBatchId ?? null }).returning();
  await tx.insert(purchaseLines).values(lineRows(c.calc).map((l, i) => ({ ...l, ...c.eligibility[i], docId: doc.id })));
  await audit(tx, user, { action: importBatchId ? "import" : "create", entityType: "purchase", entityId: doc.id, summary: `${doc.supplierName} ${doc.number}`, after: doc });
  return doc;
}

export async function createPurchase(db: Db, user: SessionUser, input: PurchaseInput) {
  return db.transaction((tx) => insertPurchase(tx, user, input));
}

export async function updatePurchase(db: Db, user: SessionUser, id: number, input: PurchaseInput) {
  return db.transaction(async (tx) => {
    const biz = await getBusiness(tx);
    const before = await getPurchase(tx, id);
    if (before.doc.status === "cancelled") throw conflict("A cancelled bill cannot be edited");
    const c = computePurchase(input, biz);
    await assertUnlocked(tx, biz.filingFrequency, {
      dates: [before.doc.date, input.date], periods: [before.doc.itcPeriod, c.itcPeriod],
    });
    await assertPurchaseUnique(tx, input, id);
    const [doc] = await tx.update(purchases).set({ ...purchaseValues(input, c), updatedAt: new Date() })
      .where(eq(purchases.id, id)).returning();
    await tx.delete(purchaseLines).where(eq(purchaseLines.docId, id));
    await tx.insert(purchaseLines).values(lineRows(c.calc).map((l, i) => ({ ...l, ...c.eligibility[i], docId: id })));
    await audit(tx, user, { action: "update", entityType: "purchase", entityId: id, summary: `${doc.supplierName} ${doc.number}`, before: before.doc, after: doc });
    return doc;
  });
}

export async function cancelPurchase(db: Db, user: SessionUser, id: number, reason: string) {
  return db.transaction(async (tx) => {
    const biz = await getBusiness(tx);
    const { doc } = await getPurchase(tx, id);
    if (doc.status === "cancelled") throw conflict("Already cancelled");
    await assertUnlocked(tx, biz.filingFrequency, { dates: [doc.date], periods: [doc.itcPeriod] });
    const notes = [doc.notes, `Cancelled: ${reason}`].filter(Boolean).join("\n");
    const [after] = await tx.update(purchases).set({ status: "cancelled", notes, updatedAt: new Date() })
      .where(eq(purchases.id, id)).returning();
    await audit(tx, user, { action: "cancel", entityType: "purchase", entityId: id, summary: `${doc.supplierName} ${doc.number}: ${reason}`, before: doc, after });
    return after;
  });
}

/**
 * Change ITC period and/or per-line eligibility. Both the old and the new ITC period
 * must be unlocked (defect 4 in AGENTS.md), as well as the bill's own period.
 */
export async function updatePurchaseItc(
  db: Db, user: SessionUser, id: number,
  change: { itcPeriod?: string; lines?: Array<{ id: number; itcEligible: boolean; itcReason?: string }> },
) {
  return db.transaction(async (tx) => {
    const biz = await getBusiness(tx);
    const before = await getPurchase(tx, id);
    const newPeriod = change.itcPeriod ?? before.doc.itcPeriod;
    if (periodRange(newPeriod).to < before.doc.date) throw unprocessable("ITC period cannot be before the bill date");
    await assertUnlocked(tx, biz.filingFrequency, { dates: [before.doc.date], periods: [before.doc.itcPeriod, newPeriod] });
    if (change.lines?.length) {
      if (biz.noItcScheme && change.lines.some((l) => l.itcEligible)) throw unprocessable("The business pays GST without ITC");
      if (!before.doc.supplierGstin && change.lines.some((l) => l.itcEligible)) throw unprocessable("No ITC on a bill from an unregistered supplier");
      const ids = new Set(before.lines.map((l) => l.id));
      for (const l of change.lines) {
        if (!ids.has(l.id)) throw notFound(`Line ${l.id} is not on this bill`);
        await tx.update(purchaseLines).set({
          itcEligible: l.itcEligible, itcReason: l.itcEligible ? "" : l.itcReason || "Marked ineligible",
        }).where(eq(purchaseLines.id, l.id));
      }
    }
    const lines = await tx.select().from(purchaseLines).where(eq(purchaseLines.docId, id));
    const itcTotal = lines.filter((l) => l.itcEligible).reduce((s, l) => s + l.cgst + l.sgst + l.igst + l.cess, 0);
    const [doc] = await tx.update(purchases).set({ itcPeriod: newPeriod, itcTotal, updatedAt: new Date() })
      .where(eq(purchases.id, id)).returning();
    await audit(tx, user, { action: "update_itc", entityType: "purchase", entityId: id, summary: `ITC ${before.doc.itcPeriod} → ${newPeriod}`, before: before.doc, after: doc });
    return doc;
  });
}

export async function listPurchases(db: Tx, f: ListFilter & { itc?: "eligible" | "ineligible"; itcPeriod?: string }) {
  const where: SQL[] = [];
  if (f.itcPeriod) where.push(eq(purchases.itcPeriod, f.itcPeriod));
  else {
    const { from, to } = dateRange(f);
    if (from) where.push(gte(purchases.date, from));
    if (to) where.push(lte(purchases.date, to));
  }
  if (f.docType) where.push(eq(purchases.docType, f.docType as Purchase["docType"]));
  if (f.status) where.push(eq(purchases.status, f.status as Purchase["status"]));
  if (f.q) {
    const q = `%${f.q.replace(/[%_]/g, "\\$&")}%`;
    where.push(or(ilike(purchases.number, q), ilike(purchases.supplierName, q), ilike(purchases.supplierGstin, q))!);
  }
  // Defect 1: the ITC filter is applied in SQL, before pagination, so `total` stays accurate.
  if (f.itc === "eligible") where.push(sql`${purchases.itcTotal} > 0`);
  if (f.itc === "ineligible") {
    where.push(sql`exists (select 1 from ${purchaseLines} pl where pl.doc_id = ${purchases.id} and pl.itc_eligible = false)`);
  }
  const cond = where.length ? and(...where) : undefined;
  const pageSize = Math.min(Math.max(f.pageSize ?? 50, 1), 500);
  const page = Math.max(f.page ?? 1, 1);
  const rows = await db.select().from(purchases).where(cond)
    .orderBy(desc(purchases.date), desc(purchases.id)).limit(pageSize).offset((page - 1) * pageSize);
  const sign = sql`case when ${purchases.docType} = 'credit_note' then -1 else 1 end`;
  const active = sql`case when ${purchases.status} = 'active' then 1 else 0 end`;
  const [t] = await db.select({
    count: sql<number>`count(*)::int`,
    taxableValue: sql<number>`coalesce(sum(${purchases.taxableValue} * ${sign} * ${active}), 0)::bigint`,
    tax: sql<number>`coalesce(sum((${purchases.cgst} + ${purchases.sgst} + ${purchases.igst} + ${purchases.cess}) * ${sign} * ${active}), 0)::bigint`,
    itc: sql<number>`coalesce(sum(${purchases.itcTotal} * ${sign} * ${active}), 0)::bigint`,
    grandTotal: sql<number>`coalesce(sum(${purchases.grandTotal} * ${sign} * ${active}), 0)::bigint`,
  }).from(purchases).where(cond);
  return {
    rows,
    total: Number(t.count),
    page,
    pageSize,
    totals: { taxableValue: Number(t.taxableValue), tax: Number(t.tax), itc: Number(t.itc), grandTotal: Number(t.grandTotal) },
  };
}

/** For API output: qty and unit price back to decimal strings are already strings in rows. */
export function lineToInput(l: SalesLine | PurchaseLine) {
  return { ...l, qtyMilli: parseScaled(l.qty, 3), unitPriceE4: parseScaled(l.unitPrice, 4) };
}

async function withLines(db: Tx, docs: SalesDoc[]) {
  const lines = docs.length
    ? await db.select().from(salesLines).where(inArray(salesLines.docId, docs.map((d) => d.id))).orderBy(asc(salesLines.position))
    : [];
  return docs.map((d) => ({ ...d, lines: lines.filter((l) => l.docId === d.id) }));
}

/** Original documents dated in the range (an amendment is reported in its amendment period instead). */
export async function salesForRange(db: Tx, from: string, to: string) {
  const docs = await db.select().from(salesDocs)
    .where(and(gte(salesDocs.date, from), lte(salesDocs.date, to), eq(salesDocs.status, "active"), isNull(salesDocs.amendsId)))
    .orderBy(asc(salesDocs.date), asc(salesDocs.number));
  return withLines(db, docs);
}

/** Amendments reported in a period, each with the version it replaces. */
export async function amendmentsForPeriod(db: Tx, period: string) {
  const revised = await db.select().from(salesDocs)
    .where(and(eq(salesDocs.amendPeriod, period), eq(salesDocs.status, "active")))
    .orderBy(asc(salesDocs.date), asc(salesDocs.number));
  const prevIds = revised.map((r) => r.amendsId).filter((x): x is number => x != null);
  const previous = prevIds.length ? await db.select().from(salesDocs).where(inArray(salesDocs.id, prevIds)) : [];
  const [rev, prev] = [await withLines(db, revised), await withLines(db, previous)];
  return rev.map((r) => ({ revised: r, previous: prev.find((p) => p.id === r.amendsId)! })).filter((x) => x.previous);
}

export async function allSalesNumbersForRange(db: Tx, from: string, to: string) {
  return db.select({ docType: salesDocs.docType, number: salesDocs.number, status: salesDocs.status })
    .from(salesDocs).where(and(gte(salesDocs.date, from), lte(salesDocs.date, to), isNull(salesDocs.amendsId)));
}

export async function purchasesForItcPeriod(db: Tx, period: string) {
  const docs = await db.select().from(purchases)
    .where(and(eq(purchases.itcPeriod, period), eq(purchases.status, "active")))
    .orderBy(asc(purchases.date));
  const lines = docs.length
    ? await db.select().from(purchaseLines).where(inArray(purchaseLines.docId, docs.map((d) => d.id)))
    : [];
  return { docs, lines };
}

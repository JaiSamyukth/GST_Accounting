import { and, eq, gte, inArray, lte } from "drizzle-orm";
import type { Db, Tx } from "../db/client";
import { itcAdjustments, purchaseLines, purchases, returnPeriods } from "../db/schema";
import { audit } from "./audit";
import type { SessionUser } from "./auth";
import { allSalesNumbersForRange, purchasesForItcPeriod, salesForRange } from "./docs";
import { dueDates, periodRange, periodsForFy, todayIso } from "./gst/periods";
import { buildGstr1, buildGstr3b, compare1vs3b, type Gstr1Result, type Gstr3bResult, type RPurchase, type RSale } from "./gst/returns";
import { conflict, unprocessable } from "./http";
import { getBusiness } from "./settings";

export type ReturnPeriod = typeof returnPeriods.$inferSelect;
export type ReturnKind = "gstr1" | "gstr3b";

export async function ensurePeriod(db: Tx, key: string): Promise<ReturnPeriod> {
  const r = periodRange(key);
  await db.insert(returnPeriods).values({ period: key, fy: r.fy }).onConflictDoNothing();
  return (await db.select().from(returnPeriods).where(eq(returnPeriods.period, key)).limit(1))[0];
}

async function purchasesByDate(db: Tx, from: string, to: string) {
  const docs = await db.select().from(purchases)
    .where(and(gte(purchases.date, from), lte(purchases.date, to), eq(purchases.status, "active")));
  const lines = docs.length ? await db.select().from(purchaseLines).where(inArray(purchaseLines.docId, docs.map((d) => d.id))) : [];
  return { docs, lines };
}

function toRPurchases(data: { docs: Array<typeof purchases.$inferSelect>; lines: Array<typeof purchaseLines.$inferSelect> }): RPurchase[] {
  return data.docs.map((d) => ({ ...d, lines: data.lines.filter((l) => l.docId === d.id) }));
}

export interface Computed {
  period: string;
  gstr1: Gstr1Result;
  gstr3b: Gstr3bResult;
  compare: ReturnType<typeof compare1vs3b>;
  issues: string[];
}

export async function computeReturns(db: Tx, key: string): Promise<Computed> {
  const biz = await getBusiness(db);
  const r = periodRange(key);
  const row = await ensurePeriod(db, key);
  const s = await salesForRange(db, r.from, r.to);
  const sales: RSale[] = s.docs.map((d) => ({ ...d, lines: s.lines.filter((l) => l.docId === d.id) }));
  const issued = await allSalesNumbersForRange(db, r.from, r.to);
  const gstr1 = buildGstr1({ gstin: biz.gstin, fp: r.fp, businessState: biz.stateCode, sales, issued });
  const adjustments = await db.select().from(itcAdjustments).where(eq(itcAdjustments.period, key));
  const gstr3b = buildGstr3b({
    gstin: biz.gstin, fp: r.fp, businessState: biz.stateCode, sales,
    purchasesByDate: toRPurchases(await purchasesByDate(db, r.from, r.to)),
    purchasesByItc: toRPurchases(await purchasesForItcPeriod(db, key)),
    adjustments, interest: row.interest, lateFee: row.lateFee,
  });
  const compare = compare1vs3b(gstr1, gstr3b);
  const issues: string[] = [];
  if (!biz.gstin) issues.push("Business GSTIN is not set (Settings).");
  if (biz.filingFrequency === "monthly" && !/^\d{4}-\d{2}$/.test(key)) issues.push("Business files monthly but this is a quarterly period.");
  if (biz.filingFrequency === "quarterly" && /^\d{4}-\d{2}$/.test(key)) issues.push("Business files quarterly but this is a monthly period.");
  if (compare.some((c) => c.difference !== 0)) issues.push("GSTR-1 and GSTR-3B outward figures differ.");
  const missingHsn = sales.flatMap((x) => x.lines).filter((l) => !l.hsnSac).length;
  if (missingHsn) issues.push(`${missingHsn} sales line(s) have no HSN/SAC code.`);
  return { period: key, gstr1, gstr3b, compare, issues };
}

/** Use the frozen snapshot for a locked, filed period; otherwise compute live. */
export async function returnsFor(db: Tx, key: string): Promise<Computed & { fromSnapshot: boolean }> {
  const row = await ensurePeriod(db, key);
  if (row.locked && row.snapshot) return { ...(row.snapshot as Computed), fromSnapshot: true };
  return { ...(await computeReturns(db, key)), fromSnapshot: false };
}

export async function listPeriods(db: Tx, fyStart?: number) {
  const biz = await getBusiness(db);
  const fy = fyStart ?? biz.fyStartYear;
  const keys = periodsForFy(fy, biz.filingFrequency);
  const rows = await db.select().from(returnPeriods).where(inArray(returnPeriods.period, keys));
  const today = todayIso();
  return keys.map((key) => {
    const row = rows.find((r) => r.period === key);
    const due = dueDates(key);
    const g1 = row?.gstr1Status ?? "open";
    const g3 = row?.gstr3bStatus ?? "open";
    return {
      period: key,
      label: periodRange(key).label,
      gstr1Status: g1,
      gstr3bStatus: g3,
      locked: row?.locked ?? false,
      due,
      overdue: { gstr1: g1 !== "filed" && today > due.gstr1, gstr3b: g3 !== "filed" && today > due.gstr3b },
      started: periodRange(key).from <= today,
    };
  });
}

function kinds(ret: ReturnKind | "both"): ReturnKind[] {
  return ret === "both" ? ["gstr1", "gstr3b"] : [ret];
}

export async function approve(db: Db, user: SessionUser, key: string, ret: ReturnKind | "both") {
  return db.transaction(async (tx) => {
    const row = await ensurePeriod(tx, key);
    if (row.locked) throw conflict("Period is locked");
    const c = await computeReturns(tx, key);
    const set: Partial<ReturnPeriod> = { approvedBy: user.id, approvedAt: new Date(), figures: c, updatedAt: new Date() };
    for (const k of kinds(ret)) {
      if ((k === "gstr1" ? row.gstr1Status : row.gstr3bStatus) === "filed") throw conflict(`${k.toUpperCase()} is already filed`);
      if (k === "gstr1") set.gstr1Status = "approved";
      else set.gstr3bStatus = "approved";
    }
    const [after] = await tx.update(returnPeriods).set(set).where(eq(returnPeriods.id, row.id)).returning();
    await audit(tx, user, { action: "approve", entityType: "return", entityId: key, summary: `Approved ${ret} for ${key}` });
    return after;
  });
}

export async function markFiled(db: Db, user: SessionUser, key: string, ret: ReturnKind, arn: string, filedOn: string) {
  return db.transaction(async (tx) => {
    const row = await ensurePeriod(tx, key);
    if (row.locked) throw conflict("Period is locked");
    const status = ret === "gstr1" ? row.gstr1Status : row.gstr3bStatus;
    if (status === "filed") throw conflict(`${ret.toUpperCase()} is already filed`);
    if (status !== "approved") throw unprocessable(`Approve ${ret.toUpperCase()} before marking it filed`);
    const set: Partial<ReturnPeriod> = ret === "gstr1"
      ? { gstr1Status: "filed", gstr1Arn: arn, gstr1FiledOn: filedOn }
      : { gstr3bStatus: "filed", gstr3bArn: arn, gstr3bFiledOn: filedOn };
    const bothFiled = (ret === "gstr1" ? row.gstr3bStatus : row.gstr1Status) === "filed";
    if (bothFiled) {
      set.snapshot = await computeReturns(tx, key);
      set.locked = true;
    }
    const [after] = await tx.update(returnPeriods).set({ ...set, updatedAt: new Date() }).where(eq(returnPeriods.id, row.id)).returning();
    await audit(tx, user, { action: "file", entityType: "return", entityId: key, summary: `${ret.toUpperCase()} filed, ARN ${arn}${bothFiled ? "; period locked" : ""}` });
    return after;
  });
}

export async function recordPayment(
  db: Db, user: SessionUser, key: string,
  p: { paidIgst: number; paidCgst: number; paidSgst: number; paidCess: number; interest: number; lateFee: number; challanRef: string; paidOn: string | null },
) {
  return db.transaction(async (tx) => {
    const row = await ensurePeriod(tx, key);
    if (row.locked) throw conflict("Period is locked");
    const [after] = await tx.update(returnPeriods).set({ ...p, updatedAt: new Date() }).where(eq(returnPeriods.id, row.id)).returning();
    await audit(tx, user, { action: "payment", entityType: "return", entityId: key, summary: `Payment recorded ${p.challanRef}`, before: row, after });
    return after;
  });
}

export async function lockPeriod(db: Db, user: SessionUser, key: string) {
  return db.transaction(async (tx) => {
    const row = await ensurePeriod(tx, key);
    if (row.locked) throw conflict("Period is already locked");
    const [after] = await tx.update(returnPeriods).set({ locked: true, snapshot: await computeReturns(tx, key), updatedAt: new Date() })
      .where(eq(returnPeriods.id, row.id)).returning();
    await audit(tx, user, { action: "lock", entityType: "return", entityId: key, summary: `Locked ${key}` });
    return after;
  });
}

/**
 * Unlock (defect 2): back to an editable, consistent state. Filed returns go back to
 * "approved", ARNs and filed dates are cleared, and the snapshot moves to the audit log.
 */
export async function unlockPeriod(db: Db, user: SessionUser, key: string, reason: string) {
  return db.transaction(async (tx) => {
    const row = await ensurePeriod(tx, key);
    if (!row.locked) throw conflict("Period is not locked");
    const back = (s: ReturnPeriod["gstr1Status"]) => (s === "filed" ? "approved" : s);
    const [after] = await tx.update(returnPeriods).set({
      locked: false,
      gstr1Status: back(row.gstr1Status),
      gstr3bStatus: back(row.gstr3bStatus),
      gstr1Arn: "", gstr3bArn: "", gstr1FiledOn: null, gstr3bFiledOn: null,
      snapshot: null,
      notes: [row.notes, `Unlocked ${todayIso()}: ${reason}`].filter(Boolean).join("\n"),
      updatedAt: new Date(),
    }).where(eq(returnPeriods.id, row.id)).returning();
    await audit(tx, user, { action: "unlock", entityType: "return", entityId: key, summary: `Unlocked ${key}: ${reason}`, before: row, after });
    return after;
  });
}

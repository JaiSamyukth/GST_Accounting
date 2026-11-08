import { and, asc, eq, ne } from "drizzle-orm";
import type { Db, Tx } from "../db/client";
import { gstr2bEntries, purchases } from "../db/schema";
import { audit } from "./audit";
import type { SessionUser } from "./auth";
import type { TwoBRow } from "./gst/gstr2b";
import { normaliseNumber, reconcile, type ReconRow } from "./gst/recon";
import { assertUnlocked } from "./locks";
import { getBusiness } from "./settings";

/** Replace the GSTR-2B rows held for a period, then refresh each bill's match status. */
export async function import2b(db: Db, user: SessionUser, period: string, rows: TwoBRow[], filename: string) {
  return db.transaction(async (tx) => {
    const biz = await getBusiness(tx);
    await assertUnlocked(tx, biz.filingFrequency, { periods: [period] });
    await tx.delete(gstr2bEntries).where(eq(gstr2bEntries.period, period));
    const valid = rows.filter((r) => r.supplierGstin && r.number && r.date);
    if (valid.length) await tx.insert(gstr2bEntries).values(valid.map((r) => ({ ...r, period })));
    const recon = await reconFor(tx, period);
    for (const r of recon.rows) {
      if (r.book) await tx.update(purchases).set({ reconStatus: r.status }).where(eq(purchases.id, r.book.id));
    }
    await audit(tx, user, { action: "import", entityType: "gstr2b", entityId: period, summary: `${valid.length} GSTR-2B row(s) from ${filename}` });
    return { imported: valid.length, skipped: rows.length - valid.length, summary: recon.summary };
  });
}

export async function reconFor(db: Tx, period: string) {
  const entries = await db.select().from(gstr2bEntries).where(eq(gstr2bEntries.period, period)).orderBy(asc(gstr2bEntries.id));
  const books = await db.select().from(purchases)
    .where(and(eq(purchases.itcPeriod, period), eq(purchases.status, "active"), ne(purchases.supplierGstin, "")));
  const rows: ReconRow[] = entries.length ? reconcile(books, entries) : [];
  // A 2B row missing from this period's books may be booked with another ITC period.
  for (const r of rows) {
    if (r.status !== "missing_in_books" || !r.twoB) continue;
    const others = await db.select({ number: purchases.number, itcPeriod: purchases.itcPeriod }).from(purchases)
      .where(and(eq(purchases.supplierGstin, r.twoB.supplierGstin), eq(purchases.status, "active")));
    const hit = others.find((o) => normaliseNumber(o.number) === normaliseNumber(r.twoB!.number));
    if (hit) r.note = `Entered in purchases with ITC period ${hit.itcPeriod}`;
  }
  const summary = { matched: 0, mismatch: 0, probable: 0, missing_in_2b: 0, missing_in_books: 0 } as Record<ReconRow["status"], number>;
  for (const r of rows) summary[r.status] += 1;
  return { period, hasEntries: entries.length > 0, entries: entries.length, rows, summary };
}

/** Bills whose ITC is deferred because the period's GSTR-2B does not show them. */
export async function deferredBillIds(db: Tx, period: string): Promise<number[]> {
  const r = await reconFor(db, period);
  return r.rows.filter((x) => x.status === "missing_in_2b" && x.book).map((x) => x.book!.id);
}

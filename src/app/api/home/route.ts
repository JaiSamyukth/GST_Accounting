import { and, count, desc, eq, gte, lte } from "drizzle-orm";
import { auditLog, parties, purchases, salesDocs } from "@/db/schema";
import { dueDates, periodOf, periodRange, previousPeriod, todayIso } from "@/lib/gst/periods";
import { computeReturns, ensurePeriod } from "@/lib/returns-service";
import { route } from "@/lib/route";
import { getBusiness } from "@/lib/settings";

export const GET = route({}, async ({ db }) => {
  const biz = await getBusiness(db);
  const today = todayIso();
  const key = periodOf(today, biz.filingFrequency);
  const r = periodRange(key);
  const [s] = await db.select({ n: count() }).from(salesDocs).where(and(gte(salesDocs.date, r.from), lte(salesDocs.date, r.to), eq(salesDocs.status, "active")));
  const [p] = await db.select({ n: count() }).from(purchases).where(and(gte(purchases.date, r.from), lte(purchases.date, r.to), eq(purchases.status, "active")));
  const c = await computeReturns(db, key);
  const t = c.gstr3b.t31.a;
  const outputTax = t.iamt + t.camt + t.samt + t.csamt + c.gstr3b.t31.b.iamt + c.gstr3b.t31.b.csamt;
  const n = c.gstr3b.t4.c;
  const cash = c.gstr3b.payment.cash;

  const prev = previousPeriod(key);
  const prevRow = await ensurePeriod(db, prev);
  const prevDue = dueDates(prev);
  const warnings: string[] = [];
  if (!biz.gstin) warnings.push("Add your GSTIN in Settings before preparing returns.");
  if (!biz.legalName) warnings.push("Add your business name in Settings.");
  if (prevRow.gstr1Status !== "filed" && today > prevDue.gstr1) warnings.push(`GSTR-1 for ${periodRange(prev).label} was due on ${prevDue.gstr1} and is not marked filed.`);
  if (prevRow.gstr3bStatus !== "filed" && today > prevDue.gstr3b) warnings.push(`GSTR-3B for ${periodRange(prev).label} was due on ${prevDue.gstr3b} and is not marked filed.`);

  const recent = await db.select().from(auditLog).orderBy(desc(auditLog.at)).limit(10);
  const [anyParty] = await db.select({ n: count() }).from(parties);
  const [anySale] = await db.select({ n: count() }).from(salesDocs);
  const setup = { business: !!(biz.gstin && biz.legalName), parties: Number(anyParty.n) > 0, sale: Number(anySale.n) > 0 };
  return {
    period: key,
    label: r.label,
    counts: { sales: Number(s.n), purchases: Number(p.n) },
    outputTax,
    itc: n.igst + n.cgst + n.sgst + n.cess,
    cashPayable: cash.igst + cash.cgst + cash.sgst + cash.cess,
    due: dueDates(key),
    warnings,
    setup,
    recent: recent.map((a) => ({ at: a.at, user: a.userEmail, action: a.action, entityType: a.entityType, summary: a.summary })),
  };
});

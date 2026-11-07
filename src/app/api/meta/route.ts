import { asc, eq } from "drizzle-orm";
import { taxRates } from "@/db/schema";
import { DOC_KINDS } from "@/lib/attachments";
import { PURCHASE_CATEGORIES } from "@/lib/docs-input";
import { SUPPLY_KINDS } from "@/lib/gst/gst";
import { STATES } from "@/lib/gst/gstin";
import { fyLabel, periodOf, periodsForFy, periodRange, todayIso } from "@/lib/gst/periods";
import { ITC_RULES } from "@/lib/itc";
import { UQC } from "@/lib/masters";
import { route } from "@/lib/route";
import { getBusiness } from "@/lib/settings";

export const GET = route({}, async ({ db }) => {
  const biz = await getBusiness(db);
  const rates = await db.select().from(taxRates).where(eq(taxRates.active, true)).orderBy(asc(taxRates.rateBp));
  const periods = periodsForFy(biz.fyStartYear, biz.filingFrequency).map((key) => ({ key, label: periodRange(key).label }));
  return {
    states: Object.entries(STATES).map(([code, name]) => ({ code, name })),
    supplyKinds: SUPPLY_KINDS,
    rates,
    uqc: UQC,
    categories: Object.entries(PURCHASE_CATEGORIES).map(([key, v]) => ({ key, ...v })),
    documentKinds: DOC_KINDS,
    itcRules: ITC_RULES,
    business: biz,
    fy: { startYear: biz.fyStartYear, label: fyLabel(biz.fyStartYear) },
    periods,
    currentPeriod: periodOf(todayIso(), biz.filingFrequency),
    today: todayIso(),
  };
});

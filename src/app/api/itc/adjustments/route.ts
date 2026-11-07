import { asc, eq } from "drizzle-orm";
import { itcAdjustments } from "@/db/schema";
import { audit } from "@/lib/audit";
import { isPeriodKey } from "@/lib/gst/periods";
import { json, readJson, unprocessable } from "@/lib/http";
import { adjustmentSchema } from "@/lib/itc";
import { assertUnlocked } from "@/lib/locks";
import { route } from "@/lib/route";
import { getBusiness } from "@/lib/settings";

export const GET = route({}, async ({ req, db }) => {
  const period = new URL(req.url).searchParams.get("period");
  if (period && !isPeriodKey(period)) throw unprocessable("Invalid period");
  const rows = await db.select().from(itcAdjustments).where(period ? eq(itcAdjustments.period, period) : undefined).orderBy(asc(itcAdjustments.id));
  return { adjustments: rows };
});

export const POST = route({}, async ({ req, db, user }) => {
  const input = await readJson(req, adjustmentSchema);
  const biz = await getBusiness(db);
  await assertUnlocked(db, biz.filingFrequency, { periods: [input.period] });
  const [row] = await db.insert(itcAdjustments).values(input).returning();
  await audit(db, user, { action: "create", entityType: "itc_adjustment", entityId: row.id, summary: `${row.kind} ${row.rule} ${row.period}`, after: row });
  return json({ adjustment: row }, 201);
});

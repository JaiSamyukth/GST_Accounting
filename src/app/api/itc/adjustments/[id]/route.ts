import { eq } from "drizzle-orm";
import { itcAdjustments } from "@/db/schema";
import { audit } from "@/lib/audit";
import { idParam, notFound } from "@/lib/http";
import { assertUnlocked } from "@/lib/locks";
import { route } from "@/lib/route";
import { getBusiness } from "@/lib/settings";

export const DELETE = route<{ id: string }>({}, async ({ db, user, params }) => {
  const id = idParam(params.id);
  const row = (await db.select().from(itcAdjustments).where(eq(itcAdjustments.id, id)).limit(1))[0];
  if (!row) throw notFound();
  const biz = await getBusiness(db);
  await assertUnlocked(db, biz.filingFrequency, { periods: [row.period] });
  await db.delete(itcAdjustments).where(eq(itcAdjustments.id, id));
  await audit(db, user, { action: "delete", entityType: "itc_adjustment", entityId: id, summary: `${row.kind} ${row.rule} ${row.period}`, before: row });
  return { ok: true };
});

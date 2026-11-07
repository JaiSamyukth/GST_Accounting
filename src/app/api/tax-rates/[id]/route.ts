import { eq } from "drizzle-orm";
import { taxRates } from "@/db/schema";
import { audit } from "@/lib/audit";
import { idParam, notFound, readJson } from "@/lib/http";
import { route } from "@/lib/route";
import { rateSchema } from "@/lib/masters";

export const PUT = route<{ id: string }>({ owner: true }, async ({ req, db, user, params }) => {
  const id = idParam(params.id);
  const input = await readJson(req, rateSchema);
  const before = (await db.select().from(taxRates).where(eq(taxRates.id, id)).limit(1))[0];
  if (!before) throw notFound();
  const [row] = await db.update(taxRates).set(input).where(eq(taxRates.id, id)).returning();
  await audit(db, user, { action: "update", entityType: "tax_rate", entityId: id, summary: row.label, before, after: row });
  return { rate: row };
});

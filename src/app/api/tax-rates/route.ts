import { asc } from "drizzle-orm";
import { taxRates } from "@/db/schema";
import { audit } from "@/lib/audit";
import { readJson } from "@/lib/http";
import { rateSchema } from "@/lib/masters";
import { route } from "@/lib/route";

export const GET = route({}, async ({ db }) => ({ rates: await db.select().from(taxRates).orderBy(asc(taxRates.rateBp)) }));

export const POST = route({ owner: true }, async ({ req, db, user }) => {
  const input = await readJson(req, rateSchema);
  const [row] = await db.insert(taxRates).values(input).returning();
  await audit(db, user, { action: "create", entityType: "tax_rate", entityId: row.id, summary: row.label, after: row });
  return { rate: row };
});

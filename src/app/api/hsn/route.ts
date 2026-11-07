import { asc, ilike, or } from "drizzle-orm";
import { hsnCodes } from "@/db/schema";
import { audit } from "@/lib/audit";
import { readJson } from "@/lib/http";
import { hsnSchema } from "@/lib/masters";
import { route } from "@/lib/route";

export const GET = route({}, async ({ req, db }) => {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  const where = q ? or(ilike(hsnCodes.code, `${q}%`), ilike(hsnCodes.description, `%${q}%`)) : undefined;
  return { hsn: await db.select().from(hsnCodes).where(where).orderBy(asc(hsnCodes.code)).limit(500) };
});

export const POST = route({ owner: true }, async ({ req, db, user }) => {
  const input = await readJson(req, hsnSchema);
  const [row] = await db.insert(hsnCodes).values(input).returning();
  await audit(db, user, { action: "create", entityType: "hsn", entityId: row.id, summary: row.code, after: row });
  return { hsn: row };
});

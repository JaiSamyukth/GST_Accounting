import { and, asc, eq, ilike, or, type SQL } from "drizzle-orm";
import { parties } from "@/db/schema";
import { audit } from "@/lib/audit";
import { readJson } from "@/lib/http";
import { partySchema } from "@/lib/masters";
import { route } from "@/lib/route";

export const GET = route({}, async ({ req, db }) => {
  const sp = new URL(req.url).searchParams;
  const where: SQL[] = [];
  const kind = sp.get("kind");
  if (kind === "customer" || kind === "supplier") where.push(eq(parties.kind, kind));
  const q = sp.get("q")?.trim();
  if (q) where.push(or(ilike(parties.name, `%${q}%`), ilike(parties.gstin, `%${q}%`))!);
  if (sp.get("active") === "1") where.push(eq(parties.active, true));
  return { parties: await db.select().from(parties).where(where.length ? and(...where) : undefined).orderBy(asc(parties.name)).limit(1000) };
});

export const POST = route({}, async ({ req, db, user }) => {
  const input = await readJson(req, partySchema);
  const [row] = await db.insert(parties).values(input).returning();
  await audit(db, user, { action: "create", entityType: "party", entityId: row.id, summary: `${row.kind} ${row.name}`, after: row });
  return { party: row };
});

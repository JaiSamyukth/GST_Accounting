import { eq } from "drizzle-orm";
import { parties } from "@/db/schema";
import { audit } from "@/lib/audit";
import { idParam, notFound, readJson } from "@/lib/http";
import { route } from "@/lib/route";
import { partySchema } from "@/lib/masters";

export const PUT = route<{ id: string }>({}, async ({ req, db, user, params }) => {
  const id = idParam(params.id);
  const input = await readJson(req, partySchema);
  const before = (await db.select().from(parties).where(eq(parties.id, id)).limit(1))[0];
  if (!before) throw notFound("Party not found");
  const [row] = await db.update(parties).set({ ...input, updatedAt: new Date() }).where(eq(parties.id, id)).returning();
  await audit(db, user, { action: "update", entityType: "party", entityId: id, summary: `${row.kind} ${row.name}`, before, after: row });
  return { party: row };
});

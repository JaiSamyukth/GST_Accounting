import { eq } from "drizzle-orm";
import { hsnCodes } from "@/db/schema";
import { audit } from "@/lib/audit";
import { idParam, notFound, readJson } from "@/lib/http";
import { route } from "@/lib/route";
import { hsnSchema } from "@/lib/masters";

export const PUT = route<{ id: string }>({ owner: true }, async ({ req, db, user, params }) => {
  const id = idParam(params.id);
  const input = await readJson(req, hsnSchema);
  const before = (await db.select().from(hsnCodes).where(eq(hsnCodes.id, id)).limit(1))[0];
  if (!before) throw notFound();
  const [row] = await db.update(hsnCodes).set(input).where(eq(hsnCodes.id, id)).returning();
  await audit(db, user, { action: "update", entityType: "hsn", entityId: id, summary: row.code, before, after: row });
  return { hsn: row };
});

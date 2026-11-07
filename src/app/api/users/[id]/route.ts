import { eq } from "drizzle-orm";
import { z } from "zod";
import { sessions, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { conflict, idParam, notFound, readJson } from "@/lib/http";
import { route } from "@/lib/route";
import { otherActiveOwner, publicUserColumns } from "@/lib/users";

export const PATCH = route<{ id: string }>({ owner: true }, async ({ req, db, user, params }) => {
  const id = idParam(params.id);
  const input = await readJson(req, z.object({
    name: z.string().trim().min(1).max(100).optional(),
    role: z.enum(["owner", "accountant"]).optional(),
    isActive: z.boolean().optional(),
  }));
  const before = (await db.select(publicUserColumns).from(users).where(eq(users.id, id)).limit(1))[0];
  if (!before) throw notFound("User not found");
  const losesOwner = before.role === "owner" && before.isActive && (input.role === "accountant" || input.isActive === false);
  if (losesOwner && !(await otherActiveOwner(db, id))) throw conflict("There must be at least one active owner");
  const [after] = await db.update(users).set({ ...input, updatedAt: new Date() }).where(eq(users.id, id)).returning(publicUserColumns);
  if (input.isActive === false) await db.update(sessions).set({ revoked: true }).where(eq(sessions.userId, id));
  await audit(db, user, { action: "update", entityType: "user", entityId: id, summary: after.email, before, after });
  return { user: after };
});

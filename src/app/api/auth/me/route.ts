import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { readJson } from "@/lib/http";
import { route } from "@/lib/route";

export const GET = route({}, async ({ user }) => ({ user }));

export const PATCH = route({}, async ({ req, db, user }) => {
  const { name } = await readJson(req, z.object({ name: z.string().trim().min(1).max(100) }));
  await db.update(users).set({ name, updatedAt: new Date() }).where(eq(users.id, user.id));
  await audit(db, user, { action: "update", entityType: "user", entityId: user.id, summary: "Changed own name" });
  return { user: { ...user, name } };
});

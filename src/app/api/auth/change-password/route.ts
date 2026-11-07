import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { sessions, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { checkPasswordRules, hashPassword, verifyPassword } from "@/lib/auth";
import { readJson, unprocessable } from "@/lib/http";
import { route } from "@/lib/route";

export const POST = route({}, async ({ req, db, user }) => {
  const { current, next } = await readJson(req, z.object({ current: z.string(), next: z.string() }));
  const u = (await db.select().from(users).where(eq(users.id, user.id)).limit(1))[0];
  if (!(await verifyPassword(current, u.passwordHash))) throw unprocessable("Current password is wrong");
  checkPasswordRules(next);
  if (current === next) throw unprocessable("New password must be different");
  await db.update(users).set({ passwordHash: await hashPassword(next), mustChangePassword: false, updatedAt: new Date() }).where(eq(users.id, user.id));
  // Sign out every other session.
  await db.update(sessions).set({ revoked: true }).where(and(eq(sessions.userId, user.id), ne(sessions.id, user.sessionId)));
  await audit(db, user, { action: "change_password", entityType: "user", entityId: user.id, summary: "Password changed" });
  return { ok: true };
});

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { passwordResets, sessions, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { checkPasswordRules, hashPassword, sha256 } from "@/lib/auth";
import { readJson, unprocessable } from "@/lib/http";
import { publicRoute } from "@/lib/route";

export const POST = publicRoute(async ({ req, db }) => {
  const { token, password } = await readJson(req, z.object({ token: z.string().min(10), password: z.string() }));
  checkPasswordRules(password);
  const hash = await hashPassword(password);
  const user = await db.transaction(async (tx) => {
    const r = (await tx.select().from(passwordResets).where(eq(passwordResets.tokenHash, sha256(token))).limit(1))[0];
    if (!r || r.used || r.expiresAt.getTime() < Date.now()) throw unprocessable("This reset link is invalid or has expired");
    const claimed = await tx.update(passwordResets).set({ used: true })
      .where(and(eq(passwordResets.id, r.id), eq(passwordResets.used, false))).returning();
    if (!claimed.length) throw unprocessable("This reset link has already been used");
    const [u] = await tx.update(users).set({ passwordHash: hash, mustChangePassword: false, updatedAt: new Date() }).where(eq(users.id, r.userId)).returning();
    await tx.update(sessions).set({ revoked: true }).where(eq(sessions.userId, r.userId));
    return u;
  });
  await audit(db, user, { action: "reset_password", entityType: "user", entityId: user.id, summary: "Password reset with link" });
  return { ok: true };
});

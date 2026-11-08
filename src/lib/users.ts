import { and, eq, ne } from "drizzle-orm";
import type { Db } from "../db/client";
import { passwordResets, users } from "../db/schema";
import { newToken, sha256 } from "./auth";

export const RESET_HOURS = 72;

export async function createResetLink(db: Db, userId: number): Promise<{ url: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + RESET_HOURS * 3600_000);
  await db.update(passwordResets).set({ used: true }).where(and(eq(passwordResets.userId, userId), eq(passwordResets.used, false)));
  await db.insert(passwordResets).values({ userId, tokenHash: sha256(token), expiresAt });
  const base = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return { url: `${base}/reset?token=${encodeURIComponent(token)}`, expiresAt };
}

/** True if some other active owner exists. */
export async function otherActiveOwner(db: Db, exceptId: number): Promise<boolean> {
  const r = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.role, "owner"), eq(users.isActive, true), ne(users.id, exceptId))).limit(1);
  return r.length > 0;
}

export const publicUserColumns = {
  id: users.id, email: users.email, name: users.name, role: users.role, isActive: users.isActive,
  mustChangePassword: users.mustChangePassword, createdAt: users.createdAt,
};

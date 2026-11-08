// Print a one-time password reset link for a user: npm run user:reset-link -- owner@example.com
import { eq } from "drizzle-orm";
import { getDb } from "./client";
import { users } from "./schema";
import { createResetLink } from "../lib/users";

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!email) {
  console.error("Usage: npm run user:reset-link -- <email>");
  process.exit(1);
}
const db = await getDb();
const u = (await db.select({ id: users.id, isActive: users.isActive }).from(users).where(eq(users.email, email)).limit(1))[0];
if (!u) {
  console.error(`No user with email ${email}`);
  process.exit(1);
}
if (!u.isActive) await db.update(users).set({ isActive: true }).where(eq(users.id, u.id));
const link = await createResetLink(db, u.id);
console.log(`Reset link (valid until ${link.expiresAt.toISOString()}):\n${link.url}`);
process.exit(0);

import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "@/db/schema";
import { createSession, MAX_FAILURES, recentFailures, recordLogin, sessionCookie, verifyPassword } from "@/lib/auth";
import { HttpError, json, readJson, unauthorized } from "@/lib/http";
import { publicRoute } from "@/lib/route";

const schema = z.object({ email: z.string().trim().toLowerCase().min(1), password: z.string().min(1) });

export const POST = publicRoute(async ({ req, db }) => {
  const { email, password } = await readJson(req, schema);
  if ((await recentFailures(db, email)) >= MAX_FAILURES) {
    await recordLogin(db, req, email, false, "throttled", null);
    throw new HttpError(429, "Too many failed attempts. Wait 15 minutes and try again.");
  }
  const u = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
  if (!u || !u.isActive || !(await verifyPassword(password, u.passwordHash))) {
    await recordLogin(db, req, email, false, u && !u.isActive ? "inactive" : "bad_password", u?.id ?? null);
    throw unauthorized("Email or password is wrong");
  }
  await recordLogin(db, req, email, true, "login", u.id);
  const token = await createSession(db, u.id, req);
  return json({ ok: true, user: { id: u.id, email: u.email, name: u.name, role: u.role, mustChangePassword: u.mustChangePassword } }, 200, { "Set-Cookie": sessionCookie(token) });
});

import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, count, eq, gt } from "drizzle-orm";
import type { Db } from "../db/client";
import { loginHistory, sessions, users } from "../db/schema";
import { clientIp, forbidden, parseCookies, unauthorized, unprocessable } from "./http";

export const SESSION_COOKIE = "gst_session";

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: "owner" | "accountant";
  mustChangePassword: boolean;
  tutorialDone: boolean;
  sessionId: number;
}

const cost = () => (process.env.NODE_ENV === "test" ? 4 : 12);

export function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, cost());
}

export function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export function checkPasswordRules(pw: string): void {
  if (pw.length < 10) throw unprocessable("Password must be at least 10 characters");
  if (pw.length > 200) throw unprocessable("Password is too long");
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) throw unprocessable("Password must contain letters and numbers");
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function sessionHours(): number {
  const h = Number(process.env.SESSION_HOURS ?? "12");
  return Number.isFinite(h) && h > 0 ? h : 12;
}

export function sessionCookie(token: string): string {
  const secure = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.round(sessionHours() * 3600)}${secure}`;
}

export function clearSessionCookie(): string {
  const secure = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export async function createSession(db: Db, userId: number, req: Request): Promise<string> {
  const token = newToken();
  await db.insert(sessions).values({
    tokenHash: sha256(token),
    userId,
    expiresAt: new Date(Date.now() + sessionHours() * 3600_000),
    ip: clientIp(req),
    userAgent: (req.headers.get("user-agent") ?? "").slice(0, 300),
  });
  return token;
}

export async function getSessionUser(db: Db, req: Request): Promise<SessionUser | null> {
  const token = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE];
  if (!token) return null;
  const rows = await db
    .select({ s: sessions, u: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, sha256(token)))
    .limit(1);
  const row = rows[0];
  if (!row || row.s.revoked || row.s.expiresAt.getTime() < Date.now() || !row.u.isActive) return null;
  if (Date.now() - row.s.lastSeen.getTime() > 60_000) {
    await db.update(sessions).set({ lastSeen: new Date() }).where(eq(sessions.id, row.s.id));
  }
  return {
    id: row.u.id,
    email: row.u.email,
    name: row.u.name,
    role: row.u.role,
    mustChangePassword: row.u.mustChangePassword,
    tutorialDone: row.u.tutorialDone,
    sessionId: row.s.id,
  };
}

export async function requireUser(db: Db, req: Request): Promise<SessionUser> {
  const u = await getSessionUser(db, req);
  if (!u) throw unauthorized();
  return u;
}

export function assertOwner(u: SessionUser): void {
  if (u.role !== "owner") throw forbidden();
}

export const MAX_FAILURES = 8;
export const THROTTLE_MINUTES = 15;

export async function recentFailures(db: Db, email: string): Promise<number> {
  const since = new Date(Date.now() - THROTTLE_MINUTES * 60_000);
  const r = await db
    .select({ n: count() })
    .from(loginHistory)
    .where(and(eq(loginHistory.email, email), eq(loginHistory.success, false), gt(loginHistory.at, since)));
  return Number(r[0]?.n ?? 0);
}

export async function recordLogin(
  db: Db, req: Request, email: string, success: boolean, event: string, userId: number | null,
): Promise<void> {
  await db.insert(loginHistory).values({
    email, success, event, userId, ip: clientIp(req), userAgent: (req.headers.get("user-agent") ?? "").slice(0, 300),
  });
}

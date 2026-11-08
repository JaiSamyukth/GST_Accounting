import { and, desc, eq, gt } from "drizzle-orm";
import { sessions } from "@/db/schema";
import { route } from "@/lib/route";

export const GET = route({}, async ({ db, user }) => {
  const rows = await db.select({
    id: sessions.id, createdAt: sessions.createdAt, lastSeen: sessions.lastSeen, expiresAt: sessions.expiresAt,
    ip: sessions.ip, userAgent: sessions.userAgent,
  }).from(sessions)
    .where(and(eq(sessions.userId, user.id), eq(sessions.revoked, false), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastSeen));
  return { sessions: rows.map((s) => ({ ...s, current: s.id === user.sessionId })) };
});

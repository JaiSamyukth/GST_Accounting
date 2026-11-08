import { and, eq } from "drizzle-orm";
import { sessions } from "@/db/schema";
import { idParam, notFound } from "@/lib/http";
import { route } from "@/lib/route";

export const DELETE = route<{ id: string }>({}, async ({ db, user, params }) => {
  const r = await db.update(sessions).set({ revoked: true })
    .where(and(eq(sessions.id, idParam(params.id)), eq(sessions.userId, user.id))).returning({ id: sessions.id });
  if (!r.length) throw notFound("Session not found");
  return { ok: true };
});

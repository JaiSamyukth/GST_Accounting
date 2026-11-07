import { eq } from "drizzle-orm";
import { sessions } from "@/db/schema";
import { clearSessionCookie, recordLogin } from "@/lib/auth";
import { json } from "@/lib/http";
import { publicRoute } from "@/lib/route";

export const POST = publicRoute(async ({ req, db, user }) => {
  if (user) {
    await db.update(sessions).set({ revoked: true }).where(eq(sessions.id, user.sessionId));
    await recordLogin(db, req, user.email, true, "logout", user.id);
  }
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
});

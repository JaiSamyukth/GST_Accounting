import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { idParam, notFound } from "@/lib/http";
import { route } from "@/lib/route";
import { createResetLink } from "@/lib/users";

export const POST = route<{ id: string }>({ owner: true }, async ({ db, user, params }) => {
  const id = idParam(params.id);
  const u = (await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, id)).limit(1))[0];
  if (!u) throw notFound("User not found");
  const link = await createResetLink(db, id);
  await audit(db, user, { action: "reset_link", entityType: "user", entityId: id, summary: u.email });
  return { link };
});

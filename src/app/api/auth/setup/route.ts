import { count, sql } from "drizzle-orm";
import { z } from "zod";
import { business, users } from "@/db/schema";
import { seed } from "@/db/seed";
import { audit } from "@/lib/audit";
import { checkPasswordRules, createSession, hashPassword, recordLogin, sessionCookie } from "@/lib/auth";
import { stateCode } from "@/lib/docs-input";
import { conflict, json, readJson } from "@/lib/http";
import { publicRoute } from "@/lib/route";

const schema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string(),
  businessName: z.string().trim().max(200).default(""),
  stateCode: stateCode.default("33"),
});

export const POST = publicRoute(async ({ req, db }) => {
  const input = await readJson(req, schema);
  checkPasswordRules(input.password);
  const passwordHash = await hashPassword(input.password);
  const user = await db.transaction(async (tx) => {
    // Lock the users table so two concurrent setups cannot both succeed.
    await tx.execute(sql`lock table users in exclusive mode`);
    const [r] = await tx.select({ n: count() }).from(users);
    if (Number(r.n) > 0) throw conflict("Setup is already complete");
    const [u] = await tx.insert(users).values({ email: input.email, name: input.name, role: "owner", passwordHash }).returning();
    return u;
  });
  await seed(db);
  if (input.businessName) {
    await db.update(business).set({ legalName: input.businessName, tradeName: input.businessName, stateCode: input.stateCode });
  } else {
    await db.update(business).set({ stateCode: input.stateCode });
  }
  await audit(db, user, { action: "setup", entityType: "user", entityId: user.id, summary: "Owner account created" });
  await recordLogin(db, req, user.email, true, "setup", user.id);
  const token = await createSession(db, user.id, req);
  return json({ ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } }, 201, { "Set-Cookie": sessionCookie(token) });
});

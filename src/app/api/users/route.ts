import { randomBytes } from "node:crypto";
import { asc } from "drizzle-orm";
import { z } from "zod";
import { users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth";
import { json, readJson } from "@/lib/http";
import { route } from "@/lib/route";
import { createResetLink, publicUserColumns } from "@/lib/users";

export const GET = route({ owner: true }, async ({ db }) => ({ users: await db.select(publicUserColumns).from(users).orderBy(asc(users.id)) }));

export const POST = route({ owner: true }, async ({ req, db, user }) => {
  const input = await readJson(req, z.object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().email(),
    role: z.enum(["owner", "accountant"]).default("accountant"),
  }));
  // Random unusable password; the new user sets their own through the link.
  const passwordHash = await hashPassword(randomBytes(24).toString("base64url"));
  const [row] = await db.insert(users).values({ ...input, passwordHash, mustChangePassword: true }).returning(publicUserColumns);
  const link = await createResetLink(db, row.id);
  await audit(db, user, { action: "create", entityType: "user", entityId: row.id, summary: `${row.role} ${row.email}` });
  return json({ user: row, link }, 201);
});

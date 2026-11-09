import { count } from "drizzle-orm";
import { users } from "@/db/schema";
import { publicRoute } from "@/lib/route";

export const GET = publicRoute(async ({ db, user }) => {
  const [r] = await db.select({ n: count() }).from(users);
  return { hasUsers: Number(r.n) > 0, user };
});

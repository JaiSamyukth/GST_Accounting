import { desc } from "drizzle-orm";
import { loginHistory } from "@/db/schema";
import { route } from "@/lib/route";

export const GET = route({ owner: true }, async ({ db }) => ({ history: await db.select().from(loginHistory).orderBy(desc(loginHistory.at)).limit(200) }));

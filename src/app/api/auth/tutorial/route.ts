import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "@/db/schema";
import { readJson } from "@/lib/http";
import { route } from "@/lib/route";

/** Mark the getting-started tutorial as finished (or not) for the signed-in user. */
export const POST = route({}, async ({ req, db, user }) => {
  const { done } = await readJson(req, z.object({ done: z.boolean() }));
  await db.update(users).set({ tutorialDone: done }).where(eq(users.id, user.id));
  return { tutorialDone: done };
});

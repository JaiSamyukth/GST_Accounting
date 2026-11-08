import { z } from "zod";
import { isPeriodKey } from "@/lib/gst/periods";
import { notFound, readJson } from "@/lib/http";
import { unlockPeriod } from "@/lib/returns-service";
import { route } from "@/lib/route";

function key(params: { key: string }): string {
  if (!isPeriodKey(params.key)) throw notFound("Unknown period");
  return params.key;
}

export const POST = route<{ key: string }>({ owner: true }, async ({ req, db, user, params }) => {
  const { reason } = await readJson(req, z.object({ reason: z.string().trim().min(5, "Write a reason (at least 5 characters)").max(500) }));
  return { status: await unlockPeriod(db, user, key(params), reason) };
});

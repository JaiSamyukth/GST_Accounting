import { isPeriodKey } from "@/lib/gst/periods";
import { notFound } from "@/lib/http";
import { lockPeriod } from "@/lib/returns-service";
import { route } from "@/lib/route";

function key(params: { key: string }): string {
  if (!isPeriodKey(params.key)) throw notFound("Unknown period");
  return params.key;
}

export const POST = route<{ key: string }>({ owner: true }, async ({ db, user, params }) => {
  return { status: await lockPeriod(db, user, key(params)) };
});

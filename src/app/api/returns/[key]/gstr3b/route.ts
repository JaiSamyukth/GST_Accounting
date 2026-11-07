import { isPeriodKey } from "@/lib/gst/periods";
import { notFound } from "@/lib/http";
import { returnsFor } from "@/lib/returns-service";
import { route } from "@/lib/route";

function key(params: { key: string }): string {
  if (!isPeriodKey(params.key)) throw notFound("Unknown period");
  return params.key;
}

export const GET = route<{ key: string }>({}, async ({ db, params }) => {
  const r = await returnsFor(db, key(params));
  return { ...r.gstr3b, fromSnapshot: r.fromSnapshot };
});

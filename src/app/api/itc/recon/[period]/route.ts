import { isPeriodKey } from "@/lib/gst/periods";
import { notFound } from "@/lib/http";
import { reconFor } from "@/lib/itc-service";
import { route } from "@/lib/route";

export const GET = route<{ period: string }>({}, async ({ db, params }) => {
  if (!isPeriodKey(params.period)) throw notFound("Unknown period");
  return reconFor(db, params.period);
});

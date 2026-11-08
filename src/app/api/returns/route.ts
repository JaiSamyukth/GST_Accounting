import { listPeriods } from "@/lib/returns-service";
import { route } from "@/lib/route";

export const GET = route({}, async ({ req, db }) => {
  const fy = new URL(req.url).searchParams.get("fy");
  return { periods: await listPeriods(db, fy ? Number(fy) || undefined : undefined) };
});

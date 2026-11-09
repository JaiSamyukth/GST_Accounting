import { buildReport, resolveFilter } from "@/lib/reports";
import { route } from "@/lib/route";
import { getBusiness } from "@/lib/settings";

export const GET = route<{ kind: string }>({}, async ({ req, db, params }) => {
  const biz = await getBusiness(db);
  const f = resolveFilter(new URL(req.url).searchParams, biz.fyStartYear);
  return { filter: f, table: await buildReport(db, params.kind, f) };
});

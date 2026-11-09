import { parseFormat, exportTables } from "@/lib/export/respond";
import { buildReport } from "@/lib/reports";
import { listFilter } from "@/lib/query";
import { periodRange, fyRange } from "@/lib/gst/periods";
import { route } from "@/lib/route";
import { getBusiness } from "@/lib/settings";

export const GET = route({}, async ({ req, db }) => {
  const sp = new URL(req.url).searchParams;
  const fmt = parseFormat(sp.get("fmt"));
  const f = listFilter(sp);
  const biz = await getBusiness(db);
  const range = f.period ? periodRange(f.period) : f.from && f.to ? { from: f.from, to: f.to } : fyRange(biz.fyStartYear);
  const t = await buildReport(db, "purchase-register", range);
  return exportTables(fmt, `purchases_${range.from}_${range.to}`, "Purchase register", `${biz.legalName} · ${range.from} to ${range.to}`, [t]);
});

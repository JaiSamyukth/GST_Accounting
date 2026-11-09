import { audit } from "@/lib/audit";
import { exportTables, parseFormat } from "@/lib/export/respond";
import { buildReport, resolveFilter } from "@/lib/reports";
import { route } from "@/lib/route";
import { getBusiness } from "@/lib/settings";

export const GET = route<{ kind: string }>({}, async ({ req, db, user, params }) => {
  const sp = new URL(req.url).searchParams;
  const fmt = parseFormat(sp.get("fmt"));
  const biz = await getBusiness(db);
  const f = resolveFilter(sp, biz.fyStartYear);
  const t = await buildReport(db, params.kind, f);
  await audit(db, user, { action: "export", entityType: "report", entityId: params.kind, summary: `${fmt} ${f.from}..${f.to}` });
  return exportTables(fmt, `${params.kind}_${f.from}_${f.to}`, t.title, `${biz.legalName} · ${f.from} to ${f.to}`, [t]);
});

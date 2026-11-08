import { audit } from "@/lib/audit";
import { gstr1Tables, gstr3bTables } from "@/lib/export/return-tables";
import { exportTables, parseFormat } from "@/lib/export/respond";
import { isPeriodKey, periodRange } from "@/lib/gst/periods";
import { notFound } from "@/lib/http";
import { returnsFor } from "@/lib/returns-service";
import { route } from "@/lib/route";
import { getBusiness } from "@/lib/settings";

/** /api/returns/2026-11/gstr1.json, gstr3b.xlsx, gstr1.csv, gstr3b.pdf … */
export const GET = route<{ key: string; file: string }>({}, async ({ db, user, params }) => {
  if (!isPeriodKey(params.key)) throw notFound("Unknown period");
  const m = /^(gstr1|gstr3b)\.(json|xlsx|csv|pdf)$/.exec(params.file);
  if (!m) throw notFound("Unknown file");
  const [, ret, fmtRaw] = m;
  const fmt = parseFormat(fmtRaw);
  const r = await returnsFor(db, params.key);
  const biz = await getBusiness(db);
  const range = periodRange(params.key);
  const label = ret === "gstr1" ? "GSTR-1" : "GSTR-3B";
  const tables = ret === "gstr1" ? gstr1Tables(r.gstr1) : gstr3bTables(r.gstr3b);
  const payload = ret === "gstr1" ? r.gstr1.payload : r.gstr3b.payload;
  await audit(db, user, { action: "export", entityType: "return", entityId: params.key, summary: `${label} ${fmt}` });
  return exportTables(fmt, `${label}_${biz.gstin || "GSTIN"}_${range.fp}`, `${label} – ${range.label}`,
    `${biz.legalName} · GSTIN ${biz.gstin || "not set"} · ${range.from} to ${range.to}${r.fromSnapshot ? " · filed snapshot" : ""}`, tables, payload);
});

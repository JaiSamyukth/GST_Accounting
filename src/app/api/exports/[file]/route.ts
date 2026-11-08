import { audit } from "@/lib/audit";
import { toCsv } from "@/lib/export/csv";
import { toXlsx } from "@/lib/export/xlsx";
import { exportTable } from "@/lib/exports";
import { IMPORT_KINDS, type ImportKind } from "@/lib/gst/importers";
import { attachment, notFound } from "@/lib/http";
import { resolveFilter } from "@/lib/reports";
import { route } from "@/lib/route";
import { getBusiness } from "@/lib/settings";

/**
 * /api/exports/sales.xlsx?period=2026-11 (or ?fy=2026, or ?from=&to=). Columns match the import
 * template, so the file can be edited and imported back or into another installation.
 */
export const GET = route<{ file: string }>({}, async ({ req, db, user, params }) => {
  const m = /^([a-z]+)\.(csv|xlsx)$/.exec(params.file);
  if (!m || !(IMPORT_KINDS as readonly string[]).includes(m[1])) throw notFound("Unknown export");
  const kind = m[1] as ImportKind;
  const biz = await getBusiness(db);
  const range = resolveFilter(new URL(req.url).searchParams, biz.fyStartYear);
  const table = await exportTable(db, kind, range);
  await audit(db, user, { action: "export", entityType: "data", entityId: kind, summary: `${table.rows.length} row(s), ${range.from}..${range.to}` });
  const dated = ["sales", "notes", "purchases", "payments"].includes(kind);
  const name = dated ? `${kind}_${range.from}_${range.to}` : kind;
  if (m[2] === "csv") return attachment(toCsv(table), `${name}.csv`, "text/csv; charset=utf-8");
  return attachment(Buffer.from(await toXlsx([table])), `${name}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
});

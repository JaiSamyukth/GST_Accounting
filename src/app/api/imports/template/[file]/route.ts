import { toCsv } from "@/lib/export/csv";
import { toXlsx } from "@/lib/export/xlsx";
import { IMPORT_KINDS, templateRows, type ImportKind } from "@/lib/gst/importers";
import { attachment, notFound } from "@/lib/http";
import { route } from "@/lib/route";

/** /api/imports/template/sales.csv or sales.xlsx */
export const GET = route<{ file: string }>({}, async ({ params }) => {
  const m = /^([a-z]+)\.(csv|xlsx)$/.exec(params.file);
  if (!m || !(IMPORT_KINDS as readonly string[]).includes(m[1])) throw notFound("Unknown template");
  const { headers, example } = templateRows(m[1] as ImportKind);
  const table = { title: m[1], columns: headers.map((h) => ({ key: h, label: h })), rows: [Object.fromEntries(headers.map((h, i) => [h, example[i]]))] };
  if (m[2] === "csv") return attachment(toCsv(table), `${m[1]}-template.csv`, "text/csv; charset=utf-8");
  return attachment(Buffer.from(await toXlsx([table])), `${m[1]}-template.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
});

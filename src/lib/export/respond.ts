import { attachment, unprocessable } from "../http";
import { toCsvMulti } from "./csv";
import { tablesPdf } from "./pdf";
import type { Table } from "./table";
import { toXlsx } from "./xlsx";

export const FORMATS = ["pdf", "xlsx", "csv", "json"] as const;
export type Format = (typeof FORMATS)[number];

export function parseFormat(v: string | null | undefined): Format {
  if (v && (FORMATS as readonly string[]).includes(v)) return v as Format;
  throw unprocessable("Format must be pdf, xlsx, csv or json");
}

/** Stream tables in the requested format. `json` defaults to the tables themselves. */
export async function exportTables(
  fmt: Format, baseName: string, title: string, subtitle: string, tables: Table[], jsonBody?: unknown,
): Promise<Response> {
  switch (fmt) {
    case "csv":
      return attachment(toCsvMulti(tables), `${baseName}.csv`, "text/csv; charset=utf-8");
    case "xlsx":
      return attachment(Buffer.from(await toXlsx(tables)), `${baseName}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    case "pdf":
      return attachment(Buffer.from(await tablesPdf(title, subtitle, tables)), `${baseName}.pdf`, "application/pdf");
    case "json":
      return attachment(JSON.stringify(jsonBody ?? tables, null, 2), `${baseName}.json`, "application/json");
  }
}

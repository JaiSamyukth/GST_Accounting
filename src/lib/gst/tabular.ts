// Read CSV or XLSX into a header row plus string cells. Framework-free.
import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";

export interface RawTable {
  headers: string[];
  rows: string[][];
}

export const MAX_ROWS = 20_000;
export const MAX_BYTES = 20 * 1024 * 1024;

export class TableError extends Error {}

function cellToString(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    // Excel dates come back as UTC midnight.
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "object") {
    if ("result" in v && v.result !== undefined) return cellToString(v.result as ExcelJS.CellValue);
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    if ("error" in v) return "";
  }
  return String(v);
}

function trimTable(all: string[][]): RawTable {
  const nonEmpty = all.filter((r) => r.some((c) => c.trim() !== ""));
  if (!nonEmpty.length) throw new TableError("The file has no rows");
  const [headers, ...rows] = nonEmpty;
  if (rows.length > MAX_ROWS) throw new TableError(`The file has ${rows.length} rows; the limit is ${MAX_ROWS}`);
  return { headers: headers.map((h) => h.trim()), rows: rows.map((r) => headers.map((_, i) => (r[i] ?? "").trim())) };
}

export async function readTable(bytes: Uint8Array, filename: string): Promise<RawTable> {
  if (bytes.byteLength > MAX_BYTES) throw new TableError("The file is larger than 20 MB");
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  if (ext === "csv" || ext === "txt") {
    let text = new TextDecoder("utf-8").decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    try {
      const records = parse(text, { relax_column_count: true, skip_empty_lines: true, bom: true }) as string[][];
      return trimTable(records);
    } catch (e) {
      throw new TableError(`Could not read the CSV: ${(e as Error).message}`);
    }
  }
  if (ext === "xlsx") {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
    } catch {
      throw new TableError("Could not read the Excel file. Save it as .xlsx and try again.");
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new TableError("The workbook has no sheets");
    const out: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) cells.push(cellToString(row.getCell(c).value));
      out.push(cells);
    });
    return trimTable(out);
  }
  if (ext === "xls") throw new TableError("Old .xls files are not supported. Save as .xlsx or .csv.");
  throw new TableError("Upload a .csv or .xlsx file");
}

/** Lower-case, alphanumerics only: "Customer GSTIN" -> "customergstin". */
export function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

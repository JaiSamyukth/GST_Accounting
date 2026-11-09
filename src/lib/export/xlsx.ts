import ExcelJS from "exceljs";
import type { Table } from "./table";

const INR_FORMAT = "[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00";

export async function toXlsx(tables: Table[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "GST Accounting";
  const used = new Set<string>();
  for (const t of tables) {
    let name = t.title.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet";
    for (let i = 2; used.has(name); i++) name = `${name.slice(0, 28)} ${i}`;
    used.add(name);
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = t.columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, c.label.length + 2) }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } };
    const all = [...t.rows, ...(t.totals ? [t.totals] : [])];
    for (const r of all) {
      const values: Record<string, unknown> = {};
      for (const c of t.columns) {
        const v = r[c.key];
        if (c.type === "money" && typeof v === "number") values[c.key] = v / 100;
        else if (c.type === "bp" && typeof v === "number") values[c.key] = v / 100;
        else values[c.key] = v ?? "";
      }
      ws.addRow(values);
    }
    t.columns.forEach((c, i) => {
      if (c.type === "money") ws.getColumn(i + 1).numFmt = INR_FORMAT;
    });
    if (t.totals) ws.getRow(all.length + 1).font = { bold: true };
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

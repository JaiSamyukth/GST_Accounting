import { formatScaled } from "../money";
import type { Cell, Column, Table } from "./table";

function cellText(c: Column, v: Cell): string {
  if (v === null || v === undefined) return "";
  if (c.type === "money" && typeof v === "number") return formatScaled(v, 2);
  if (c.type === "bp" && typeof v === "number") return String(v / 100);
  return String(v);
}

function escape(s: string): string {
  // Neutralise spreadsheet formulas and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** UTF-8 CSV with BOM so Excel opens Indian text correctly. */
export function toCsv(t: Table): string {
  const lines = [t.columns.map((c) => escape(c.label)).join(",")];
  for (const r of [...t.rows, ...(t.totals ? [t.totals] : [])]) {
    lines.push(t.columns.map((c) => escape(cellText(c, r[c.key] ?? null))).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Several tables in one CSV, separated by a title line and a blank line. */
export function toCsvMulti(tables: Table[]): string {
  return "﻿" + tables.map((t) => `${escape(t.title)}\r\n` + toCsv(t).slice(1)).join("\r\n");
}

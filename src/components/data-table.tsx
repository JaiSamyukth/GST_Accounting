"use client";

import type { Cell, Column, Table } from "@/lib/export/table";
import { formatINR } from "@/lib/money";

function text(c: Column, v: Cell): string {
  if (v === null || v === undefined) return "";
  if (c.type === "money" && typeof v === "number") return formatINR(v);
  if (c.type === "bp" && typeof v === "number") return `${v / 100}%`;
  return String(v);
}

export function DataTable({ table, showTitle = true }: { table: Table; showTitle?: boolean }) {
  const num = (c: Column) => (c.type && c.type !== "text" ? "num" : undefined);
  return (
    <>
      {showTitle ? <h3>{table.title}</h3> : null}
      {table.rows.length === 0 ? <p className="muted">No rows.</p> : (
        <div className="table-wrap"><table>
          <thead><tr>{table.columns.map((c) => <th key={c.key} className={num(c)}>{c.label}</th>)}</tr></thead>
          <tbody>
            {table.rows.map((r, i) => <tr key={i}>{table.columns.map((c) => <td key={c.key} className={num(c)}>{text(c, r[c.key])}</td>)}</tr>)}
            {table.totals ? <tr className="total">{table.columns.map((c) => <td key={c.key} className={num(c)}>{text(c, table.totals![c.key])}</td>)}</tr> : null}
          </tbody>
        </table></div>
      )}
    </>
  );
}

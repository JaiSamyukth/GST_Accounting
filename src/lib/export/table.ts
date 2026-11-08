// A plain table that every exporter understands.
export interface Column {
  key: string;
  label: string;
  /** "money" values are paise; "bp" values are basis points; "number" right-aligned. */
  type?: "text" | "money" | "bp" | "number";
}

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;

export interface Table {
  title: string;
  columns: Column[];
  rows: Row[];
  /** Optional totals row, same keys as columns. */
  totals?: Row;
}

export function totalsFor(columns: Column[], rows: Row[], label = "Total"): Row {
  const t: Row = {};
  columns.forEach((c, i) => {
    if (c.type === "money") t[c.key] = rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
    else if (i === 0) t[c.key] = label;
    else t[c.key] = "";
  });
  return t;
}

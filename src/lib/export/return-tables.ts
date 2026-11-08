import { STATES } from "../gst/gstin";
import type { Gstr1Result, Gstr3bResult, Heads, Tax } from "../gst/returns";
import { totalsFor, type Column, type Table } from "./table";

const TAX_COLS: Column[] = [
  { key: "txval", label: "Taxable value", type: "money" },
  { key: "iamt", label: "IGST", type: "money" },
  { key: "camt", label: "CGST", type: "money" },
  { key: "samt", label: "SGST", type: "money" },
  { key: "csamt", label: "Cess", type: "money" },
];
const HEAD_COLS: Column[] = [
  { key: "igst", label: "IGST", type: "money" },
  { key: "cgst", label: "CGST", type: "money" },
  { key: "sgst", label: "SGST", type: "money" },
  { key: "cess", label: "Cess", type: "money" },
];
const pos = (code: string) => `${code}-${STATES[code] ?? ""}`;

export const SECTION_LABELS: Record<string, string> = {
  b2b: "B2B invoices (4A)",
  b2cl: "B2C large invoices (5)",
  b2cs: "B2C small (7)",
  exp: "Exports (6A)",
  cdnr: "Credit/debit notes – registered (9B)",
  cdnur: "Credit/debit notes – unregistered (9B)",
  b2ba: "Amended B2B invoices (9A)",
  b2cla: "Amended B2C large invoices (9A)",
  cdnra: "Amended credit/debit notes – registered (9C)",
};

export function gstr1Tables(g: Gstr1Result): Table[] {
  const summaryRows = Object.entries(g.summary).map(([s, v]) => ({ section: SECTION_LABELS[s] ?? s, count: v.count, ...v.tax }));
  const summaryCols: Column[] = [{ key: "section", label: "Section" }, { key: "count", label: "Documents", type: "number" }, ...TAX_COLS];
  const tables: Table[] = [{ title: "GSTR-1 summary", columns: summaryCols, rows: summaryRows }];

  const docCols: Column[] = [
    { key: "number", label: "Number" }, { key: "date", label: "Date" }, { key: "party", label: "Party" },
    { key: "gstin", label: "GSTIN" }, { key: "pos", label: "Place of supply" }, { key: "noteType", label: "Note" },
    { key: "rateBp", label: "Rate", type: "bp" }, ...TAX_COLS,
  ];
  for (const s of ["b2b", "b2cl", "exp", "cdnr", "cdnur", "b2ba", "b2cla", "cdnra"]) {
    const rows = g.rows.filter((r) => r.section === s).map(({ tax, ...r }) => ({ ...r, pos: pos(r.pos), ...tax }));
    if (rows.length) tables.push({ title: SECTION_LABELS[s], columns: docCols, rows, totals: totalsFor(docCols, rows) });
  }
  const b2csCols: Column[] = [{ key: "splyTy", label: "Supply type" }, { key: "pos", label: "Place of supply" }, { key: "rateBp", label: "Rate", type: "bp" }, ...TAX_COLS];
  const b2cs = g.b2cs.map((b) => ({ splyTy: b.splyTy, pos: pos(b.pos), rateBp: b.rateBp, ...b.tax }));
  tables.push({ title: SECTION_LABELS.b2cs, columns: b2csCols, rows: b2cs, totals: totalsFor(b2csCols, b2cs) });

  const nilCols: Column[] = [{ key: "splyTy", label: "Supply type" }, { key: "nil", label: "Nil rated", type: "money" }, { key: "exempt", label: "Exempt", type: "money" }, { key: "nonGst", label: "Non-GST", type: "money" }];
  const nilLabel: Record<string, string> = { INTRB2B: "Inter-state to registered", INTRAB2B: "Intra-state to registered", INTRB2C: "Inter-state to unregistered", INTRAB2C: "Intra-state to unregistered" };
  tables.push({ title: "Nil rated, exempt, non-GST (8)", columns: nilCols, rows: g.nil.map((n) => ({ ...n, splyTy: nilLabel[n.splyTy] })) });

  const hsnCols: Column[] = [
    { key: "hsn", label: "HSN/SAC" }, { key: "description", label: "Description" }, { key: "uqc", label: "UQC" },
    { key: "qty", label: "Qty", type: "number" }, { key: "rateBp", label: "Rate", type: "bp" }, ...TAX_COLS,
  ];
  for (const [k, label] of [["b2b", "HSN summary – B2B (12)"], ["b2c", "HSN summary – B2C (12)"]] as const) {
    const rows = g.hsn[k].map(({ tax, ...h }) => ({ ...h, ...tax }));
    tables.push({ title: label, columns: hsnCols, rows, totals: totalsFor(hsnCols, rows) });
  }
  tables.push({
    title: "Documents issued (13)",
    columns: [
      { key: "label", label: "Document" }, { key: "from", label: "From" }, { key: "to", label: "To" },
      { key: "total", label: "Total", type: "number" }, { key: "cancelled", label: "Cancelled", type: "number" }, { key: "net", label: "Net issued", type: "number" },
    ],
    rows: g.docIssue,
  });
  return tables;
}

export function gstr3bTables(g: Gstr3bResult): Table[] {
  const t = (label: string, x: Tax) => ({ label, ...x });
  const h = (label: string, x: Heads) => ({ label, ...x });
  const p = g.payment;
  return [
    {
      title: "3.1 Outward and reverse-charge inward supplies",
      columns: [{ key: "label", label: "Nature of supply" }, ...TAX_COLS],
      rows: [
        t("(a) Outward taxable (other than zero rated, nil, exempt)", g.t31.a),
        t("(b) Outward zero rated", g.t31.b),
        t("(c) Other outward (nil rated, exempted)", g.t31.c),
        t("(d) Inward supplies liable to reverse charge", g.t31.d),
        t("(e) Non-GST outward supplies", g.t31.e),
      ],
    },
    {
      title: "3.2 Inter-state supplies to unregistered persons",
      columns: [{ key: "pos", label: "Place of supply" }, { key: "txval", label: "Taxable value", type: "money" }, { key: "iamt", label: "IGST", type: "money" }],
      rows: g.t32.map((r) => ({ ...r, pos: pos(r.pos) })),
    },
    {
      title: "4 Eligible ITC",
      columns: [{ key: "label", label: "Details" }, ...HEAD_COLS],
      rows: [
        h("4A(3) Inward supplies liable to reverse charge", g.t4.a3),
        h("4A(5) All other ITC", g.t4.a5),
        h("4B(1) Reversed: rules 38, 42, 43 and section 17(5)", g.t4.b1),
        h("4B(2) Reversed: others", g.t4.b2),
        h("4C Net ITC available (A − B)", g.t4.c),
        h("4D(1) ITC reclaimed (shown in 4A(5))", g.t4.d1),
      ],
    },
    {
      title: "5 Exempt, nil and non-GST inward supplies",
      columns: [{ key: "label", label: "Nature" }, { key: "inter", label: "Inter-state", type: "money" }, { key: "intra", label: "Intra-state", type: "money" }],
      rows: [
        { label: "Composition, exempt and nil rated", inter: g.t5.gstInter, intra: g.t5.gstIntra },
        { label: "Non-GST supply", inter: g.t5.nonGstInter, intra: g.t5.nonGstIntra },
      ],
    },
    {
      title: "6.1 Payment of tax",
      columns: [
        { key: "label", label: "Head" }, { key: "liability", label: "Tax payable", type: "money" },
        { key: "byIgst", label: "Paid by IGST ITC", type: "money" }, { key: "byCgst", label: "Paid by CGST ITC", type: "money" },
        { key: "bySgst", label: "Paid by SGST ITC", type: "money" }, { key: "byCess", label: "Paid by cess ITC", type: "money" },
        { key: "rcm", label: "Reverse charge (cash)", type: "money" }, { key: "cash", label: "Paid in cash", type: "money" },
      ],
      rows: (["igst", "cgst", "sgst", "cess"] as const).map((k) => ({
        label: k.toUpperCase(), liability: p.liability[k], byIgst: p.paidByItc[k].igst, byCgst: p.paidByItc[k].cgst,
        bySgst: p.paidByItc[k].sgst, byCess: p.paidByItc[k].cess, rcm: p.rcm[k], cash: p.cash[k],
      })),
    },
    {
      title: "ITC carried forward",
      columns: [{ key: "label", label: "" }, ...HEAD_COLS],
      rows: [h("Balance after set-off", p.carryForward)],
    },
  ];
}

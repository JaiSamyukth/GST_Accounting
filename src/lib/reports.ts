import { and, asc, eq, gte, isNull, lte, ne } from "drizzle-orm";
import type { Tx } from "../db/client";
import { purchaseLines, purchases, salesDocs, salesLines } from "../db/schema";
import { STATES } from "./gst/gstin";
import { fyRange, periodRange } from "./gst/periods";
import { listPeriods } from "./returns-service";
import { notFound, unprocessable } from "./http";
import { totalsFor, type Column, type Row, type Table } from "./export/table";

export interface ReportFilter {
  from: string;
  to: string;
}

export const REPORTS = {
  "sales-register": "Sales register",
  "purchase-register": "Purchase register",
  "hsn-summary": "HSN/SAC summary of sales",
  "rate-summary": "Sales by GST rate",
  "tax-summary": "Monthly tax summary (output tax vs ITC)",
  "customer-sales": "Customer-wise sales",
  "supplier-purchases": "Supplier-wise purchases",
  "itc-register": "ITC register (purchase lines)",
  "ineligible-itc": "Ineligible ITC",
  "notes-register": "Credit and debit notes",
  "cancelled-documents": "Cancelled documents",
  "return-status": "Return filing status",
} as const;
export type ReportKind = keyof typeof REPORTS;

const sign = (t: string) => (t === "credit_note" ? -1 : 1);
const money = (key: string, label: string): Column => ({ key, label, type: "money" });
const TAXES = [money("taxableValue", "Taxable"), money("cgst", "CGST"), money("sgst", "SGST"), money("igst", "IGST"), money("cess", "Cess")];
const DOC_LABEL: Record<string, string> = { invoice: "Invoice", credit_note: "Credit note", debit_note: "Debit note" };

/** Resolve query params into a date range: from/to, period, or fy (start year). */
export function resolveFilter(q: URLSearchParams, defaultFy: number): ReportFilter {
  const period = q.get("period");
  if (period) {
    const r = periodRange(period);
    return { from: r.from, to: r.to };
  }
  const from = q.get("from");
  const to = q.get("to");
  if (from && to) {
    if (from > to) throw unprocessable("From date is after To date");
    return { from, to };
  }
  const fy = Number(q.get("fy") ?? defaultFy);
  if (!Number.isInteger(fy) || fy < 2017 || fy > 2100) throw unprocessable("Invalid financial year");
  return fyRange(fy);
}

async function sales(db: Tx, f: ReportFilter, includeCancelled = false) {
  // Only the current version of an amended document counts.
  const conds = [gte(salesDocs.date, f.from), lte(salesDocs.date, f.to), isNull(salesDocs.amendedById)];
  if (!includeCancelled) conds.push(eq(salesDocs.status, "active"));
  return db.select().from(salesDocs).where(and(...conds)).orderBy(asc(salesDocs.date), asc(salesDocs.number));
}

async function purchaseRows(db: Tx, f: ReportFilter, includeCancelled = false) {
  const conds = [gte(purchases.date, f.from), lte(purchases.date, f.to)];
  if (!includeCancelled) conds.push(eq(purchases.status, "active"));
  return db.select().from(purchases).where(and(...conds)).orderBy(asc(purchases.date), asc(purchases.number));
}

function signed<T extends Record<string, unknown>>(r: T, s: number, keys: string[]): T {
  const out: Record<string, unknown> = { ...r };
  for (const k of keys) out[k] = s * (Number(r[k]) || 0);
  return out as T;
}
const MONEY_KEYS = ["taxableValue", "cgst", "sgst", "igst", "cess", "grandTotal", "itcTotal"];

function table(title: string, columns: Column[], rows: Row[]): Table {
  return { title, columns, rows, totals: columns.some((c) => c.type === "money") ? totalsFor(columns, rows) : undefined };
}

function group(rows: Row[], key: (r: Row) => string, init: (r: Row) => Row, sumKeys: string[]): Row[] {
  const m = new Map<string, Row>();
  for (const r of rows) {
    const k = key(r);
    const g = m.get(k) ?? init(r);
    for (const s of sumKeys) g[s] = (Number(g[s]) || 0) + (Number(r[s]) || 0);
    m.set(k, g);
  }
  return [...m.values()];
}

export async function buildReport(db: Tx, kind: string, f: ReportFilter): Promise<Table> {
  if (!(kind in REPORTS)) throw notFound("Unknown report");
  const title = REPORTS[kind as ReportKind];

  switch (kind as ReportKind) {
    case "sales-register": {
      const rows = (await sales(db, f)).map((d) => signed({
        date: d.date, docType: DOC_LABEL[d.docType], number: d.number, party: d.partyName, gstin: d.partyGstin,
        pos: d.placeOfSupply, section: d.section, taxableValue: d.taxableValue, cgst: d.cgst, sgst: d.sgst,
        igst: d.igst, cess: d.cess, grandTotal: d.grandTotal,
      }, sign(d.docType), MONEY_KEYS));
      return table(title, [
        { key: "date", label: "Date" }, { key: "docType", label: "Type" }, { key: "number", label: "Number" },
        { key: "party", label: "Customer" }, { key: "gstin", label: "GSTIN" }, { key: "pos", label: "POS" },
        { key: "section", label: "Section" }, ...TAXES, money("grandTotal", "Total"),
      ], rows);
    }
    case "purchase-register": {
      const rows = (await purchaseRows(db, f)).map((d) => signed({
        date: d.date, docType: DOC_LABEL[d.docType], number: d.number, supplier: d.supplierName, gstin: d.supplierGstin,
        itcPeriod: d.itcPeriod, taxableValue: d.taxableValue, cgst: d.cgst, sgst: d.sgst, igst: d.igst, cess: d.cess,
        itcTotal: d.itcTotal, grandTotal: d.grandTotal,
      }, sign(d.docType), MONEY_KEYS));
      return table(title, [
        { key: "date", label: "Date" }, { key: "docType", label: "Type" }, { key: "number", label: "Number" },
        { key: "supplier", label: "Supplier" }, { key: "gstin", label: "GSTIN" }, { key: "itcPeriod", label: "ITC period" },
        ...TAXES, money("itcTotal", "ITC"), money("grandTotal", "Total"),
      ], rows);
    }
    case "hsn-summary":
    case "rate-summary": {
      const lines = await db.select({ l: salesLines, docType: salesDocs.docType }).from(salesLines)
        .innerJoin(salesDocs, eq(salesDocs.id, salesLines.docId))
        .where(and(gte(salesDocs.date, f.from), lte(salesDocs.date, f.to), eq(salesDocs.status, "active"), isNull(salesDocs.amendedById)));
      const flat: Row[] = lines.map(({ l, docType }) => signed({
        hsn: l.hsnSac, description: l.description, rateBp: l.gstRateBp, qty: sign(docType) * Number(l.qty),
        taxableValue: l.taxableValue, cgst: l.cgst, sgst: l.sgst, igst: l.igst, cess: l.cess, total: l.total,
      }, sign(docType), ["taxableValue", "cgst", "sgst", "igst", "cess", "total"]));
      const sum = ["qty", "taxableValue", "cgst", "sgst", "igst", "cess", "total"];
      if (kind === "hsn-summary") {
        const rows = group(flat, (r) => `${r.hsn}|${r.rateBp}`, (r) => ({ hsn: r.hsn, description: r.description, rateBp: r.rateBp }), sum)
          .sort((a, b) => String(a.hsn).localeCompare(String(b.hsn)));
        return table(title, [{ key: "hsn", label: "HSN/SAC" }, { key: "description", label: "Description" }, { key: "rateBp", label: "Rate", type: "bp" }, { key: "qty", label: "Qty", type: "number" }, ...TAXES, money("total", "Total")], rows);
      }
      const rows = group(flat, (r) => String(r.rateBp), (r) => ({ rateBp: r.rateBp }), sum.slice(1))
        .sort((a, b) => Number(a.rateBp) - Number(b.rateBp));
      return table(title, [{ key: "rateBp", label: "Rate", type: "bp" }, ...TAXES, money("total", "Total")], rows);
    }
    case "tax-summary": {
      const out = (await sales(db, f)).map((d) => ({ month: d.date.slice(0, 7), s: sign(d.docType), d }));
      const inw = await purchaseRows(db, f);
      const months = new Map<string, Row>();
      const get = (m: string) => {
        const r = months.get(m) ?? { month: m, sales: 0, outputTax: 0, purchases: 0, itc: 0, net: 0 };
        months.set(m, r);
        return r;
      };
      for (const { month, s, d } of out) {
        const r = get(month);
        r.sales = Number(r.sales) + s * d.taxableValue;
        r.outputTax = Number(r.outputTax) + s * (d.cgst + d.sgst + d.igst + d.cess);
      }
      for (const p of inw) {
        const r = get(p.date.slice(0, 7));
        const s = sign(p.docType);
        r.purchases = Number(r.purchases) + s * p.taxableValue;
        r.itc = Number(r.itc) + s * p.itcTotal;
      }
      const rows = [...months.values()].sort((a, b) => String(a.month).localeCompare(String(b.month)));
      for (const r of rows) r.net = Number(r.outputTax) - Number(r.itc);
      return table(title, [
        { key: "month", label: "Month" }, money("sales", "Taxable sales"), money("outputTax", "Output tax"),
        money("purchases", "Taxable purchases"), money("itc", "ITC (by bill date)"), money("net", "Output tax − ITC"),
      ], rows);
    }
    case "customer-sales": {
      const flat = (await sales(db, f)).map((d) => signed({ party: d.partyName, gstin: d.partyGstin, count: 1, taxableValue: d.taxableValue, cgst: d.cgst, sgst: d.sgst, igst: d.igst, cess: d.cess, grandTotal: d.grandTotal }, sign(d.docType), MONEY_KEYS));
      const rows = group(flat, (r) => `${r.party}|${r.gstin}`, (r) => ({ party: r.party, gstin: r.gstin }), ["count", ...MONEY_KEYS.slice(0, 6)])
        .sort((a, b) => Number(b.grandTotal) - Number(a.grandTotal));
      return table(title, [{ key: "party", label: "Customer" }, { key: "gstin", label: "GSTIN" }, { key: "count", label: "Documents", type: "number" }, ...TAXES, money("grandTotal", "Total")], rows);
    }
    case "supplier-purchases": {
      const flat = (await purchaseRows(db, f)).map((d) => signed({ party: d.supplierName, gstin: d.supplierGstin, count: 1, taxableValue: d.taxableValue, cgst: d.cgst, sgst: d.sgst, igst: d.igst, cess: d.cess, itcTotal: d.itcTotal, grandTotal: d.grandTotal }, sign(d.docType), MONEY_KEYS));
      const rows = group(flat, (r) => `${r.party}|${r.gstin}`, (r) => ({ party: r.party, gstin: r.gstin }), ["count", ...MONEY_KEYS])
        .sort((a, b) => Number(b.grandTotal) - Number(a.grandTotal));
      return table(title, [{ key: "party", label: "Supplier" }, { key: "gstin", label: "GSTIN" }, { key: "count", label: "Bills", type: "number" }, ...TAXES, money("itcTotal", "ITC"), money("grandTotal", "Total")], rows);
    }
    case "itc-register":
    case "ineligible-itc": {
      const conds = [gte(purchases.date, f.from), lte(purchases.date, f.to), eq(purchases.status, "active")];
      if (kind === "ineligible-itc") conds.push(eq(purchaseLines.itcEligible, false));
      const lines = await db.select({ l: purchaseLines, p: purchases }).from(purchaseLines)
        .innerJoin(purchases, eq(purchases.id, purchaseLines.docId)).where(and(...conds))
        .orderBy(asc(purchases.date), asc(purchases.number), asc(purchaseLines.position));
      const rows = lines.map(({ l, p }) => {
        const s = sign(p.docType);
        const tax = l.cgst + l.sgst + l.igst + l.cess;
        return {
          date: p.date, number: p.number, supplier: p.supplierName, itcPeriod: p.itcPeriod, description: l.description,
          taxableValue: s * l.taxableValue, cgst: s * l.cgst, sgst: s * l.sgst, igst: s * l.igst, cess: s * l.cess,
          eligible: l.itcEligible ? "Yes" : "No", itc: l.itcEligible ? s * tax : 0, reason: l.itcReason,
        };
      });
      return table(title, [
        { key: "date", label: "Date" }, { key: "number", label: "Bill" }, { key: "supplier", label: "Supplier" },
        { key: "itcPeriod", label: "ITC period" }, { key: "description", label: "Item" }, ...TAXES,
        { key: "eligible", label: "Eligible" }, money("itc", "ITC claimed"), { key: "reason", label: "Reason" },
      ], rows);
    }
    case "notes-register": {
      const rows = (await sales(db, f)).filter((d) => d.docType !== "invoice").map((d) => ({
        date: d.date, docType: DOC_LABEL[d.docType], number: d.number, party: d.partyName, original: d.originalNumber,
        reason: d.noteReason, taxableValue: d.taxableValue, cgst: d.cgst, sgst: d.sgst, igst: d.igst, cess: d.cess, grandTotal: d.grandTotal,
      }));
      return table(title, [
        { key: "date", label: "Date" }, { key: "docType", label: "Type" }, { key: "number", label: "Number" },
        { key: "party", label: "Customer" }, { key: "original", label: "Against invoice" }, { key: "reason", label: "Reason" },
        ...TAXES, money("grandTotal", "Total"),
      ], rows);
    }
    case "cancelled-documents": {
      const s = (await db.select().from(salesDocs).where(and(gte(salesDocs.date, f.from), lte(salesDocs.date, f.to), ne(salesDocs.status, "active"))))
        .map((d) => ({ date: d.date, kind: `Sale – ${DOC_LABEL[d.docType]}`, number: d.number, party: d.partyName, grandTotal: d.grandTotal, notes: d.notes }));
      const p = (await db.select().from(purchases).where(and(gte(purchases.date, f.from), lte(purchases.date, f.to), ne(purchases.status, "active"))))
        .map((d) => ({ date: d.date, kind: `Purchase – ${DOC_LABEL[d.docType]}`, number: d.number, party: d.supplierName, grandTotal: d.grandTotal, notes: d.notes }));
      const rows = [...s, ...p].sort((a, b) => a.date.localeCompare(b.date));
      return table(title, [{ key: "date", label: "Date" }, { key: "kind", label: "Document" }, { key: "number", label: "Number" }, { key: "party", label: "Party" }, money("grandTotal", "Amount"), { key: "notes", label: "Notes" }], rows);
    }
    case "return-status": {
      const fy = Number(f.from.slice(0, 4)) - (Number(f.from.slice(5, 7)) >= 4 ? 0 : 1);
      const rows = (await listPeriods(db, fy)).map((p) => ({
        period: p.label, gstr1: p.gstr1Status, gstr1Due: p.due.gstr1, gstr3b: p.gstr3bStatus, gstr3bDue: p.due.gstr3b,
        locked: p.locked ? "Yes" : "No", overdue: [p.overdue.gstr1 ? "GSTR-1" : "", p.overdue.gstr3b ? "GSTR-3B" : ""].filter(Boolean).join(", "),
      }));
      return table(title, [
        { key: "period", label: "Period" }, { key: "gstr1", label: "GSTR-1" }, { key: "gstr1Due", label: "Due" },
        { key: "gstr3b", label: "GSTR-3B" }, { key: "gstr3bDue", label: "Due" }, { key: "locked", label: "Locked" }, { key: "overdue", label: "Overdue" },
      ], rows);
    }
  }
}

export function stateLabel(code: string): string {
  return `${code} ${STATES[code] ?? ""}`.trim();
}

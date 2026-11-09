// Bulk import: kinds, header mapping, coercion, validation and grouping. Pure functions.
import { z, ZodError } from "zod";
import { partySchema, hsnSchema } from "../masters";
import { purchaseSchema, saleSchema, toEngineLine, type PurchaseInput, type SaleInput } from "../docs-input";
import { formatINR, formatScaled, paise, parseScaled, roundHalfUp } from "../money";
import { calcLine, isIntraState, type CalcContext } from "./gst";
import { STATES } from "./gstin";
import { isIsoDate, isPeriodKey } from "./periods";
import { normHeader, type RawTable } from "./tabular";

export const IMPORT_KINDS = ["sales", "notes", "purchases", "customers", "suppliers", "hsn", "payments"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export interface FieldDef { key: string; label: string; required?: boolean; aliases?: string[]; example: string }

const lineFields: FieldDef[] = [
  { key: "description", label: "Item description", required: true, aliases: ["item", "particulars", "itemname", "product", "service"], example: "Wedding lunch" },
  { key: "hsn_sac", label: "HSN/SAC", aliases: ["hsn", "sac", "hsncode", "hsnsac"], example: "996334" },
  { key: "qty", label: "Quantity", aliases: ["quantity", "nos", "members", "plates", "pax", "persons"], example: "100" },
  { key: "unit", label: "Unit (UQC)", aliases: ["uqc", "uom"], example: "OTH" },
  { key: "rate", label: "Rate per unit (₹) — or give the taxable value instead", aliases: ["price", "unitprice", "unitrate"], example: "250" },
  { key: "discount", label: "Discount (₹)", aliases: ["disc"], example: "0" },
  { key: "gst_rate", label: "GST rate (%)", required: true, aliases: ["gst", "gstpercent", "taxrate", "rateofgst"], example: "5" },
  { key: "cess_rate", label: "Cess rate (%)", aliases: ["cess"], example: "0" },
  { key: "supply_kind", label: "Supply kind (taxable/nil/exempt/non_gst/zero_rated)", aliases: ["kind", "supplytype"], example: "taxable" },
  { key: "taxable_value", label: "Taxable value of the line (₹), instead of a rate per unit", aliases: ["taxable", "taxableamount", "assessablevalue", "valuebeforetax"], example: "" },
  { key: "cgst", label: "CGST amount (₹), checked if given", aliases: ["cgstamount", "centraltax"], example: "" },
  { key: "sgst", label: "SGST amount (₹), checked if given", aliases: ["sgstamount", "statetax", "sgstutgst"], example: "" },
  { key: "igst", label: "IGST amount (₹), checked if given", aliases: ["igstamount", "integratedtax"], example: "" },
];

const saleDocFields: FieldDef[] = [
  { key: "number", label: "Invoice number", required: true, aliases: ["invoiceno", "invoicenumber", "billno", "docno", "invno", "notenumber", "noteno"], example: "INV-0001" },
  { key: "date", label: "Date (YYYY-MM-DD or DD-MM-YYYY)", required: true, aliases: ["invoicedate", "billdate", "docdate", "notedate"], example: "2026-11-05" },
  { key: "customer_name", label: "Customer name", required: true, aliases: ["customer", "party", "partyname", "buyer", "name"], example: "Kumar Weddings" },
  { key: "customer_gstin", label: "Customer GSTIN", aliases: ["gstin", "partygstin", "buyergstin", "gstinuin"], example: "" },
  { key: "place_of_supply", label: "Place of supply (code or state)", aliases: ["pos", "placeofsupply", "state"], example: "33" },
  { key: "customer_address", label: "Customer address", aliases: ["address"], example: "" },
  { key: "price_mode", label: "Price mode (exclusive/inclusive)", aliases: ["pricemode", "inclusive"], example: "exclusive" },
  { key: "reverse_charge", label: "Reverse charge (Y/N)", aliases: ["rcm", "reversecharge"], example: "N" },
  { key: "is_export", label: "Export (Y/N)", aliases: ["export"], example: "N" },
  { key: "export_with_igst", label: "Export with IGST (Y/N)", aliases: ["withigst", "exportwithpayment"], example: "N" },
  { key: "order_ref", label: "Order reference", aliases: ["order", "orderref", "eventref"], example: "" },
  { key: "notes", label: "Notes", aliases: ["remarks", "narration"], example: "" },
];

const noteFields: FieldDef[] = [
  { key: "doc_type", label: "Type (credit_note/debit_note)", required: true, aliases: ["type", "notetype", "doctype"], example: "credit_note" },
  { key: "original_number", label: "Original invoice number", required: true, aliases: ["originalinvoice", "againstinvoice", "originalno", "invoiceno"], example: "INV-0001" },
  { key: "original_date", label: "Original invoice date", aliases: ["originaldate", "invoicedate"], example: "2026-11-05" },
  { key: "reason", label: "Reason", aliases: ["notereason"], example: "Fewer plates served" },
];

const purchaseFields: FieldDef[] = [
  { key: "doc_type", label: "Type (invoice/credit_note/debit_note)", aliases: ["type", "doctype"], example: "invoice" },
  { key: "number", label: "Bill number", required: true, aliases: ["billno", "invoiceno", "invoicenumber", "billnumber", "supplierinvoiceno"], example: "AS-778" },
  { key: "date", label: "Bill date", required: true, aliases: ["billdate", "invoicedate"], example: "2026-11-02" },
  { key: "supplier_name", label: "Supplier name", required: true, aliases: ["supplier", "party", "partyname", "vendor", "name"], example: "Anna Stores" },
  { key: "supplier_gstin", label: "Supplier GSTIN", aliases: ["gstin", "partygstin", "suppliergstin", "ctin"], example: "" },
  { key: "supplier_state", label: "Supplier state (code or name)", aliases: ["state", "supplierstate"], example: "33" },
  { key: "category", label: "Category (goods/services/capital_goods/food_blocked/motor_vehicle/personal/other)", aliases: ["expensetype"], example: "goods" },
  { key: "itc_period", label: "ITC period (YYYY-MM)", aliases: ["itcperiod"], example: "" },
  { key: "price_mode", label: "Price mode (exclusive/inclusive)", aliases: ["pricemode"], example: "exclusive" },
  { key: "reverse_charge", label: "Reverse charge (Y/N)", aliases: ["rcm", "reversecharge"], example: "N" },
  ...lineFields,
  { key: "itc_eligible", label: "Claim ITC (Y/N)", aliases: ["itc", "itceligible"], example: "Y" },
  { key: "itc_reason", label: "Reason ITC not claimed", aliases: ["itcreason"], example: "" },
  { key: "original_number", label: "Original bill (for notes)", aliases: ["originalbill"], example: "" },
  { key: "notes", label: "Notes", aliases: ["remarks", "narration"], example: "" },
];

const partyFields: FieldDef[] = [
  { key: "name", label: "Name", required: true, aliases: ["party", "partyname", "client", "customer", "supplier", "customername", "suppliername"], example: "Kumar Weddings" },
  { key: "gstin", label: "GSTIN", aliases: ["gstinuin"], example: "" },
  { key: "state", label: "State (code or name)", aliases: ["statecode", "pos"], example: "33" },
  { key: "address", label: "Address", example: "" },
  { key: "phone", label: "Phone", aliases: ["mobile", "contact"], example: "" },
  { key: "email", label: "Email", example: "" },
];

export const KINDS: Record<ImportKind, { label: string; fields: FieldDef[] }> = {
  sales: { label: "Sales invoices (one row per item)", fields: [...saleDocFields, ...lineFields] },
  notes: { label: "Credit and debit notes (one row per item)", fields: [...noteFields, ...saleDocFields, ...lineFields] },
  purchases: { label: "Purchase bills (one row per item)", fields: purchaseFields },
  customers: { label: "Customers", fields: partyFields },
  suppliers: { label: "Suppliers", fields: partyFields },
  hsn: {
    label: "HSN/SAC codes",
    fields: [
      { key: "code", label: "HSN/SAC code", required: true, aliases: ["hsn", "sac", "hsncode"], example: "996334" },
      { key: "description", label: "Description", required: true, aliases: ["desc"], example: "Outdoor catering" },
      { key: "gst_rate", label: "GST rate (%)", required: true, aliases: ["rate", "gst"], example: "5" },
      { key: "supply_kind", label: "Supply kind", aliases: ["kind"], example: "taxable" },
      { key: "uqc", label: "UQC", aliases: ["unit"], example: "OTH" },
      { key: "is_service", label: "Service (Y/N)", aliases: ["service"], example: "Y" },
    ],
  },
  payments: {
    label: "Tax payments per return period",
    fields: [
      { key: "period", label: "Period (YYYY-MM or YYYY-Qn)", required: true, aliases: ["month", "returnperiod"], example: "2026-10" },
      { key: "igst", label: "IGST paid (₹)", example: "0" },
      { key: "cgst", label: "CGST paid (₹)", example: "597.50" },
      { key: "sgst", label: "SGST paid (₹)", example: "597.50" },
      { key: "cess", label: "Cess paid (₹)", example: "0" },
      { key: "interest", label: "Interest (₹)", example: "0" },
      { key: "late_fee", label: "Late fee (₹)", aliases: ["latefee"], example: "0" },
      { key: "challan_ref", label: "Challan (CPIN/CIN)", aliases: ["cin", "cpin", "challan"], example: "" },
      { key: "paid_on", label: "Paid on", aliases: ["paymentdate", "date"], example: "2026-11-18" },
    ],
  },
};

export type Mapping = Record<string, number>; // field key -> column index (-1 = not mapped)

export function autoMap(kind: ImportKind, headers: string[]): Mapping {
  const m = autoMapFields(KINDS[kind].fields, headers);
  // In accounting exports with a "Taxable" column, a bare "Rate" column is the GST rate, not a price.
  if (m.taxable_value >= 0 && m.gst_rate < 0 && m.rate >= 0 && normHeader(headers[m.rate]) === "rate") {
    m.gst_rate = m.rate;
    m.rate = -1;
  }
  return m;
}

export function autoMapFields(fields: FieldDef[], headers: string[]): Mapping {
  const norm = headers.map(normHeader);
  const used = new Set<number>();
  const m: Mapping = {};
  for (const f of fields) {
    const names = [normHeader(f.key), normHeader(f.label), ...(f.aliases ?? []).map(normHeader)];
    const i = norm.findIndex((h, idx) => !used.has(idx) && names.includes(h));
    m[f.key] = i;
    if (i >= 0) used.add(i);
  }
  return m;
}

// ---- value parsing ---------------------------------------------------------

export function parseDate(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  if (isIsoDate(s)) return s;
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) {
    const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    if (isIsoDate(iso)) return iso;
  }
  const t = /^(\d{4})-(\d{2})-(\d{2})T/.exec(s);
  if (t && isIsoDate(`${t[1]}-${t[2]}-${t[3]}`)) return `${t[1]}-${t[2]}-${t[3]}`;
  throw new Error(`"${v}" is not a date (use YYYY-MM-DD or DD-MM-YYYY)`);
}

export function parseBool(v: string, dflt = false): boolean {
  const s = v.trim().toLowerCase();
  if (!s) return dflt;
  if (["y", "yes", "true", "1"].includes(s)) return true;
  if (["n", "no", "false", "0"].includes(s)) return false;
  throw new Error(`"${v}" should be Y or N`);
}

/** "5", "5%", "18.00" -> basis points. */
export function parsePercent(v: string, dflt = 0): number {
  const s = v.replace("%", "").trim();
  if (!s) return dflt;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`"${v}" is not a valid percentage`);
  return Math.round(n * 100);
}

const STATE_BY_NAME = Object.fromEntries(Object.entries(STATES).map(([c, n]) => [normHeader(n), c]));

export function parseState(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  const code = /^(\d{1,2})\b/.exec(s)?.[1]?.padStart(2, "0");
  if (code && STATES[code]) return code;
  const byName = STATE_BY_NAME[normHeader(s.replace(/^\d+\s*[-–]\s*/, ""))];
  if (byName) return byName;
  throw new Error(`"${v}" is not a known state`);
}

function rupees(v: string): number {
  return v.trim() ? paise(v) : 0;
}

// ---- validation --------------------------------------------------------------

export type ImportRecord =
  | { type: "sale"; input: SaleInput }
  | { type: "purchase"; input: PurchaseInput }
  | { type: "party"; input: z.output<typeof partySchema> }
  | { type: "hsn"; input: z.output<typeof hsnSchema> }
  | { type: "payment"; input: { period: string; paidIgst: number; paidCgst: number; paidSgst: number; paidCess: number; interest: number; lateFee: number; challanRef: string; paidOn: string | null } };

export interface Grouped { rows: number[]; label: string; record: ImportRecord }
export interface RowError { row: number; message: string }

export interface ValidateResult {
  records: Grouped[];
  errors: RowError[];
  /** Sheet row numbers (header = row 1) that produced an error. */
  errorRows: Set<number>;
}

interface Ctx {
  businessState: string;
  /** Active GST rates in basis points; taxable lines must use one of them. */
  rates?: number[];
}

const TAX_TOLERANCE = 100; // ₹1 per head, for rounding in other software

/** Row accessor: sheet row number and field getter. */
interface R { n: number; get: (key: string) => string }

function zodMessages(e: ZodError): string[] {
  return e.issues.map((i) => `${i.path.length ? i.path.join(".") + ": " : ""}${i.message}`);
}

function lineFrom(r: R) {
  const qty = r.get("qty") || "1";
  let unitPrice = r.get("rate").replace(/,/g, "");
  let discount = rupees(r.get("discount"));
  const taxable = r.get("taxable_value");
  if (!unitPrice && taxable) {
    // Work back from the line's taxable value: the smallest 4-decimal rate whose amount covers it,
    // with any sub-paisa excess taken off as a discount so the taxable value is exact.
    const qtyMilli = parseScaled(qty, 3);
    if (qtyMilli <= 0) throw new Error("Quantity must be more than zero");
    const target = rupees(taxable) + discount;
    const priceE4 = Math.ceil((target * 100_000) / qtyMilli);
    const gross = roundHalfUp(BigInt(qtyMilli) * BigInt(priceE4), 100_000n);
    discount += gross - target;
    unitPrice = formatScaled(priceE4, 4);
  }
  if (!unitPrice) throw new Error("Give the rate per unit or the taxable value");
  return {
    description: r.get("description"),
    hsnSac: r.get("hsn_sac").replace(/\.0+$/, ""),
    qty,
    unit: (r.get("unit") || "NOS").toUpperCase(),
    unitPrice,
    discount: formatScaled(discount, 2),
    gstRateBp: parsePercent(r.get("gst_rate")),
    cessRateBp: parsePercent(r.get("cess_rate")),
    supplyKind: (r.get("supply_kind") || "taxable").toLowerCase().replace(/[\s-]+/g, "_"),
  };
}

function docTypeOf(v: string, dflt: string): string {
  const s = normHeader(v);
  if (!s) return dflt;
  if (["invoice", "inv", "bill", "taxinvoice"].includes(s)) return "invoice";
  if (["creditnote", "cn", "credit", "c"].includes(s)) return "credit_note";
  if (["debitnote", "dn", "debit", "d"].includes(s)) return "debit_note";
  throw new Error(`"${v}" is not invoice, credit_note or debit_note`);
}

export function validateTable(kind: ImportKind, table: RawTable, mapping: Mapping, ctx: Ctx): ValidateResult {
  const errors: RowError[] = [];
  const errorRows = new Set<number>();
  const fail = (rows: number[], msg: string) => {
    for (const n of rows) {
      errors.push({ row: n, message: msg });
      errorRows.add(n);
    }
  };
  for (const f of KINDS[kind].fields) {
    if (f.required && (mapping[f.key] ?? -1) < 0) fail([1], `Column for "${f.label}" is not mapped`);
  }
  if (errors.length) return { records: [], errors, errorRows };

  const rows: R[] = table.rows.map((cells, i) => ({
    n: i + 2,
    get: (key: string) => {
      const idx = mapping[key] ?? -1;
      return idx >= 0 ? (cells[idx] ?? "").trim() : "";
    },
  }));
  const records: Grouped[] = [];

  if (kind === "sales" || kind === "notes" || kind === "purchases") {
    const groups = new Map<string, R[]>();
    for (const r of rows) {
      let key: string;
      try {
        const dt = docTypeOf(r.get("doc_type"), kind === "notes" ? "" : "invoice");
        if (!dt) throw new Error("Type is required (credit_note or debit_note)");
        if (kind === "notes" && dt === "invoice") throw new Error("Use the sales import for invoices");
        key = kind === "purchases"
          ? [dt, r.get("supplier_gstin").toUpperCase(), r.get("supplier_name").toLowerCase(), r.get("number")].join("|")
          : [dt, r.get("number")].join("|");
      } catch (e) {
        fail([r.n], (e as Error).message);
        continue;
      }
      if (!r.get("number")) {
        fail([r.n], "Number is required");
        continue;
      }
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    for (const [key, g] of groups) {
      const ns = g.map((r) => r.n);
      const head = g[0];
      try {
        const docType = key.split("|")[0];
        const docKeys = kind === "purchases" ? ["date", "supplier_name", "supplier_gstin"] : ["date", "customer_name", "customer_gstin", "place_of_supply"];
        for (const k of docKeys) {
          const vals = new Set(g.map((r) => r.get(k)).filter(Boolean));
          if (vals.size > 1) throw new Error(`Rows for ${head.get("number")} disagree on ${k.replace(/_/g, " ")}`);
        }
        const date = parseDate(head.get("date"));
        const lines = g.map((r) => {
          try {
            return lineFrom(r);
          } catch (e) {
            throw new Error(`row ${r.n}: ${(e as Error).message}`);
          }
        });
        if (kind === "purchases") {
          const gstin = head.get("supplier_gstin").replace(/\s+/g, "").toUpperCase();
          const state = parseState(head.get("supplier_state")) ?? (gstin && STATES[gstin.slice(0, 2)] ? gstin.slice(0, 2) : ctx.businessState);
          const raw = {
            docType, number: head.get("number"), date, supplierName: head.get("supplier_name"), supplierGstin: gstin,
            supplierStateCode: state, reverseCharge: parseBool(head.get("reverse_charge")),
            priceMode: (head.get("price_mode") || "exclusive").toLowerCase(),
            category: (head.get("category") || "goods").toLowerCase(),
            itcPeriod: head.get("itc_period") || undefined, notes: head.get("notes"), originalNumber: head.get("original_number"),
            lines: lines.map((l, i) => ({ ...l, itcEligible: g[i].get("itc_eligible") ? parseBool(g[i].get("itc_eligible")) : undefined, itcReason: g[i].get("itc_reason") })),
          };
          const p = purchaseSchema.safeParse(raw);
          if (!p.success) throw new Error([...rateProblems(lines, g, ctx), ...zodMessages(p.error)].join("; "));
          checkLines(p.data.lines, g, ctx, { intraState: p.data.supplierStateCode === ctx.businessState, priceMode: p.data.priceMode });
          records.push({ rows: ns, label: `${p.data.supplierName} ${p.data.number}`, record: { type: "purchase", input: p.data } });
        } else {
          const gstin = head.get("customer_gstin").replace(/\s+/g, "").toUpperCase();
          const isExport = parseBool(head.get("is_export"));
          const pos = parseState(head.get("place_of_supply")) ?? (gstin && STATES[gstin.slice(0, 2)] ? gstin.slice(0, 2) : ctx.businessState);
          const raw = {
            docType, number: head.get("number"), date, partyName: head.get("customer_name"), partyGstin: gstin,
            partyAddress: head.get("customer_address"), placeOfSupply: pos, reverseCharge: parseBool(head.get("reverse_charge")),
            priceMode: (head.get("price_mode") || "exclusive").toLowerCase(), notes: head.get("notes"),
            originalNumber: head.get("original_number"), originalDate: head.get("original_date") ? parseDate(head.get("original_date")) : null,
            noteReason: head.get("reason"), isExport, exportWithIgst: parseBool(head.get("export_with_igst")), orderRef: head.get("order_ref"),
            lines,
          };
          const p = saleSchema.safeParse(raw);
          if (!p.success) throw new Error([...rateProblems(lines, g, ctx), ...zodMessages(p.error)].join("; "));
          checkLines(p.data.lines, g, ctx, {
            intraState: isIntraState(p.data.isExport ? "96" : p.data.placeOfSupply, ctx.businessState, p.data.isExport),
            priceMode: p.data.priceMode, isExport: p.data.isExport, exportWithIgst: p.data.exportWithIgst,
          });
          records.push({ rows: ns, label: `${p.data.docType.replace("_", " ")} ${p.data.number}`, record: { type: "sale", input: p.data } });
        }
      } catch (e) {
        fail(ns, (e as Error).message);
      }
    }
    return { records, errors, errorRows };
  }

  const seen = new Set<string>();
  for (const r of rows) {
    try {
      if (kind === "customers" || kind === "suppliers") {
        const gstin = r.get("gstin").replace(/\s+/g, "").toUpperCase();
        const state = parseState(r.get("state")) ?? (gstin && STATES[gstin.slice(0, 2)] ? gstin.slice(0, 2) : ctx.businessState);
        const p = partySchema.safeParse({ kind: kind === "customers" ? "customer" : "supplier", name: r.get("name"), gstin, stateCode: state, address: r.get("address"), phone: r.get("phone"), email: r.get("email") });
        if (!p.success) throw new Error(zodMessages(p.error).join("; "));
        const key = `${p.data.name.toLowerCase()}|${p.data.gstin}`;
        if (seen.has(key)) throw new Error("Duplicate of an earlier row");
        seen.add(key);
        records.push({ rows: [r.n], label: p.data.name, record: { type: "party", input: p.data } });
      } else if (kind === "hsn") {
        const p = hsnSchema.safeParse({
          code: r.get("code").replace(/\.0+$/, ""), description: r.get("description"), defaultRateBp: parsePercent(r.get("gst_rate")),
          supplyKind: (r.get("supply_kind") || "taxable").toLowerCase(), uqc: r.get("uqc") || "NOS", isService: parseBool(r.get("is_service")),
        });
        if (!p.success) throw new Error(zodMessages(p.error).join("; "));
        if (seen.has(p.data.code)) throw new Error("Duplicate of an earlier row");
        seen.add(p.data.code);
        records.push({ rows: [r.n], label: p.data.code, record: { type: "hsn", input: p.data } });
      } else {
        const period = r.get("period");
        if (!isPeriodKey(period)) throw new Error(`"${period}" is not a period (YYYY-MM or YYYY-Qn)`);
        if (seen.has(period)) throw new Error("Duplicate of an earlier row");
        seen.add(period);
        const input = {
          period, paidIgst: rupees(r.get("igst")), paidCgst: rupees(r.get("cgst")), paidSgst: rupees(r.get("sgst")), paidCess: rupees(r.get("cess")),
          interest: rupees(r.get("interest")), lateFee: rupees(r.get("late_fee")), challanRef: r.get("challan_ref").slice(0, 50), paidOn: parseDate(r.get("paid_on")),
        };
        if (Object.values(input).some((v) => typeof v === "number" && v < 0)) throw new Error("Amounts cannot be negative");
        records.push({ rows: [r.n], label: period, record: { type: "payment", input } });
      }
    } catch (e) {
      fail([r.n], (e as Error).message);
    }
  }
  return { records, errors, errorRows };
}

/** GST rate must be one of the business's rates; tax amounts in the file must match what we compute. */
function rateProblems(lines: Array<{ gstRateBp: number; supplyKind: string }>, rows: R[], ctx: Ctx): string[] {
  if (!ctx.rates) return [];
  return lines.flatMap((l, i) => (l.supplyKind === "taxable" && !ctx.rates!.includes(l.gstRateBp)
    ? [`row ${rows[i].n}: GST rate ${l.gstRateBp / 100}% is not one of your tax rates (Settings → Tax rates)`] : []));
}

function checkLines(lines: SaleInput["lines"], rows: R[], ctx: Ctx, calc: CalcContext): void {
  const problems: string[] = rateProblems(lines, rows, ctx);
  lines.forEach((l, i) => {
    const r = rows[i];
    const given = { cgst: r.get("cgst"), sgst: r.get("sgst"), igst: r.get("igst") };
    if (!given.cgst && !given.sgst && !given.igst) return;
    const c = calcLine(toEngineLine(l), calc, i);
    for (const [head, raw] of Object.entries(given) as Array<[keyof typeof given, string]>) {
      if (!raw) continue;
      const fileAmt = rupees(raw);
      if (Math.abs(fileAmt - c[head]) > TAX_TOLERANCE) {
        problems.push(`row ${r.n}: Tax should be ${formatINR(c[head])} ${head.toUpperCase()}, the file has ${formatINR(fileAmt)}`);
      }
    }
  });
  if (problems.length) throw new Error(problems.join("; "));
}

export function templateRows(kind: ImportKind): { headers: string[]; example: string[] } {
  const f = KINDS[kind].fields;
  return { headers: f.map((x) => x.key), example: f.map((x) => x.example) };
}

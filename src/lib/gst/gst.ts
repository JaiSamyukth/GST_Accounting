import { roundHalfUp } from "../money";

export const SUPPLY_KINDS = ["taxable", "exempt", "nil", "non_gst", "zero_rated"] as const;
export type SupplyKind = (typeof SUPPLY_KINDS)[number];
export type PriceMode = "exclusive" | "inclusive";

/** Quantity is in thousandths (2.5 kg = 2500). Unit price is rupees × 10^4 (₹12.3456 = 123456). */
export interface LineInput {
  description: string;
  hsnSac: string;
  qtyMilli: number;
  unit: string;
  unitPriceE4: number;
  /** Discount in paise for the whole line. */
  discount: number;
  gstRateBp: number;
  cessRateBp: number;
  supplyKind: SupplyKind;
}

export interface LineResult extends LineInput {
  /** Effective supply kind after export/zero-rating rules. */
  supplyKind: SupplyKind;
  gstRateBp: number;
  cessRateBp: number;
  gross: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  total: number;
}

export interface CalcContext {
  intraState: boolean;
  priceMode: PriceMode;
  isExport?: boolean;
  exportWithIgst?: boolean;
  roundOff?: boolean;
}

export interface Bucket {
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  total: number;
}

export interface DocumentResult extends Bucket {
  lines: LineResult[];
  roundOff: number;
  grandTotal: number;
  byRate: Array<Bucket & { gstRateBp: number }>;
  byKind: Record<SupplyKind, Bucket>;
}

export class GstValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GstValidationError";
  }
}

const MAX_PAISE = 10_000_000_000; // ₹10 crore in paise, per value

export function emptyBucket(): Bucket {
  return { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 };
}

function addTo(b: Bucket, l: Bucket): void {
  b.taxableValue += l.taxableValue;
  b.cgst += l.cgst;
  b.sgst += l.sgst;
  b.igst += l.igst;
  b.cess += l.cess;
  b.total += l.total;
}

/** Gross line value in paise: qty × unit price, half-up to the paisa. */
export function lineGross(qtyMilli: number, unitPriceE4: number): number {
  // qty/1000 × price/10^4 rupees = qty × price / 10^7 rupees = qty × price / 10^5 paise
  return roundHalfUp(BigInt(qtyMilli) * BigInt(unitPriceE4), 100_000n);
}

function validateLine(l: LineInput, i: number): void {
  const at = `line ${i + 1}`;
  if (!SUPPLY_KINDS.includes(l.supplyKind)) throw new GstValidationError(`${at}: unknown supply kind`);
  for (const [k, v] of Object.entries({
    qty: l.qtyMilli, "unit price": l.unitPriceE4, discount: l.discount,
    "GST rate": l.gstRateBp, "cess rate": l.cessRateBp,
  })) {
    if (!Number.isSafeInteger(v)) throw new GstValidationError(`${at}: ${k} is not a valid number`);
    if (v < 0) throw new GstValidationError(`${at}: ${k} cannot be negative`);
  }
  if (l.qtyMilli === 0) throw new GstValidationError(`${at}: quantity must be more than zero`);
  if (l.gstRateBp > 10_000) throw new GstValidationError(`${at}: GST rate cannot exceed 100%`);
  if (l.cessRateBp > 10_000) throw new GstValidationError(`${at}: cess rate cannot exceed 100%`);
}

export function calcLine(input: LineInput, ctx: CalcContext, index = 0): LineResult {
  validateLine(input, index);
  let kind = input.supplyKind;
  let rate = input.gstRateBp;
  let cessRate = input.cessRateBp;

  if (ctx.isExport && kind === "taxable") kind = "zero_rated";
  if (kind === "exempt" || kind === "nil" || kind === "non_gst") {
    rate = 0;
    cessRate = 0;
  }
  if (kind === "zero_rated" && !ctx.exportWithIgst) {
    rate = 0;
    cessRate = 0;
  }
  // Zero-rated and export supplies are always inter-state (IGST).
  const intra = ctx.intraState && kind !== "zero_rated" && !ctx.isExport;

  const gross = lineGross(input.qtyMilli, input.unitPriceE4);
  if (input.discount > gross) throw new GstValidationError(`line ${index + 1}: discount exceeds line value`);
  const net = gross - input.discount;
  if (Math.abs(net) > MAX_PAISE) throw new GstValidationError(`line ${index + 1}: value too large`);

  const taxes = (taxable: number) => {
    const t = BigInt(taxable);
    const cgst = intra ? roundHalfUp(t * BigInt(rate), 20_000n) : 0;
    const sgst = cgst;
    const igst = intra ? 0 : roundHalfUp(t * BigInt(rate), 10_000n);
    const cess = roundHalfUp(t * BigInt(cessRate), 10_000n);
    return { cgst, sgst, igst, cess };
  };

  let taxableValue: number;
  let tx: ReturnType<typeof taxes>;
  if (ctx.priceMode === "inclusive") {
    taxableValue = roundHalfUp(BigInt(net) * 10_000n, BigInt(10_000 + rate + cessRate));
    tx = taxes(taxableValue);
    const residual = net - (taxableValue + tx.cgst + tx.sgst + tx.igst + tx.cess);
    taxableValue += residual; // the line total must equal what was charged
  } else {
    taxableValue = net;
    tx = taxes(taxableValue);
  }

  const total = taxableValue + tx.cgst + tx.sgst + tx.igst + tx.cess;
  return {
    ...input,
    supplyKind: kind,
    gstRateBp: rate,
    cessRateBp: cessRate,
    gross,
    taxableValue,
    ...tx,
    total,
  };
}

export function calcDocument(lines: LineInput[], ctx: CalcContext): DocumentResult {
  if (lines.length === 0) throw new GstValidationError("at least one line is required");
  if (lines.length > 500) throw new GstValidationError("too many lines (max 500)");
  const results = lines.map((l, i) => calcLine(l, ctx, i));
  const totals = emptyBucket();
  const byRate = new Map<number, Bucket & { gstRateBp: number }>();
  const byKind = Object.fromEntries(SUPPLY_KINDS.map((k) => [k, emptyBucket()])) as Record<SupplyKind, Bucket>;
  for (const r of results) {
    addTo(totals, r);
    addTo(byKind[r.supplyKind], r);
    let b = byRate.get(r.gstRateBp);
    if (!b) {
      b = { gstRateBp: r.gstRateBp, ...emptyBucket() };
      byRate.set(r.gstRateBp, b);
    }
    addTo(b, r);
  }
  const grandTotal = ctx.roundOff ? roundHalfUp(totals.total, 100) * 100 : totals.total;
  return {
    ...totals,
    lines: results,
    roundOff: grandTotal - totals.total,
    grandTotal,
    byRate: [...byRate.values()].sort((a, b) => a.gstRateBp - b.gstRateBp),
    byKind,
  };
}

// ---- classification -------------------------------------------------------

export type SalesDocType = "invoice" | "credit_note" | "debit_note";
export type Gstr1Section = "b2b" | "b2cl" | "b2cs" | "exp" | "cdnr" | "cdnur";

export interface ClassifyInput {
  docType: SalesDocType;
  partyGstin: string | null;
  placeOfSupply: string;
  businessState: string;
  isExport: boolean;
  /** Invoice value in paise (for a note, the note value). */
  invoiceValue: number;
  /** B2CL threshold in paise (default ₹1,00,000). */
  b2clLimit: number;
}

export function isIntraState(placeOfSupply: string, businessState: string, isExport: boolean): boolean {
  return !isExport && placeOfSupply !== "96" && placeOfSupply === businessState;
}

export function classifySalesDoc(c: ClassifyInput): Gstr1Section {
  const registered = !!c.partyGstin;
  const inter = !isIntraState(c.placeOfSupply, c.businessState, c.isExport);
  if (c.docType === "invoice") {
    if (c.isExport) return "exp";
    if (registered) return "b2b";
    if (inter && c.invoiceValue > c.b2clLimit) return "b2cl";
    return "b2cs";
  }
  if (registered) return "cdnr";
  if (c.isExport || (inter && c.invoiceValue > c.b2clLimit)) return "cdnur";
  return "b2cs";
}

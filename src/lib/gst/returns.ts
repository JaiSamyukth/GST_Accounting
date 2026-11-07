// Pure GSTR-1 / GSTR-3B builders. Inputs are plain rows; all money is paise.
import { roundHalfUp, toRupees } from "../money";
import { portalDate } from "./periods";

export interface RLine {
  hsnSac: string;
  description: string;
  unit: string;
  qty: string;
  gstRateBp: number;
  cessRateBp: number;
  supplyKind: string;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
}

export interface RSale {
  id: number;
  docType: "invoice" | "credit_note" | "debit_note";
  number: string;
  date: string;
  partyName: string;
  partyGstin: string;
  placeOfSupply: string;
  reverseCharge: boolean;
  isExport: boolean;
  exportWithIgst: boolean;
  section: string;
  grandTotal: number;
  originalNumber: string;
  originalDate: string | null;
  lines: RLine[];
}

export interface RPurchase {
  id: number;
  docType: "invoice" | "credit_note" | "debit_note";
  number: string;
  date: string;
  supplierGstin: string;
  supplierStateCode: string;
  placeOfSupply: string;
  reverseCharge: boolean;
  lines: Array<RLine & { itcEligible: boolean; itcReason: string }>;
}

export interface Tax { txval: number; iamt: number; camt: number; samt: number; csamt: number }
export const zeroTax = (): Tax => ({ txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });

function addLine(t: Tax, l: RLine, sign: number): void {
  t.txval += sign * l.taxableValue;
  t.iamt += sign * l.igst;
  t.camt += sign * l.cgst;
  t.samt += sign * l.sgst;
  t.csamt += sign * l.cess;
}

function addTax(t: Tax, o: Tax, sign = 1): void {
  t.txval += sign * o.txval;
  t.iamt += sign * o.iamt;
  t.camt += sign * o.camt;
  t.samt += sign * o.samt;
  t.csamt += sign * o.csamt;
}

const TAXABLE = new Set(["taxable", "zero_rated"]);
const signOf = (docType: string) => (docType === "credit_note" ? -1 : 1);
const rupeeTax = (t: Tax) => ({
  txval: toRupees(t.txval), iamt: toRupees(t.iamt), camt: toRupees(t.camt), samt: toRupees(t.samt), csamt: toRupees(t.csamt),
});
const pct = (bp: number) => bp / 100;

function itemsByRate(lines: RLine[]): Array<{ rateBp: number; tax: Tax }> {
  const m = new Map<number, Tax>();
  for (const l of lines) {
    if (!TAXABLE.has(l.supplyKind)) continue;
    const t = m.get(l.gstRateBp) ?? zeroTax();
    addLine(t, l, 1);
    m.set(l.gstRateBp, t);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([rateBp, tax]) => ({ rateBp, tax }));
}

function portalItems(lines: RLine[], withCgst: boolean) {
  return itemsByRate(lines).map((it, i) => {
    const r = rupeeTax(it.tax);
    const det: Record<string, number> = { txval: r.txval, rt: pct(it.rateBp), iamt: r.iamt };
    if (withCgst) {
      det.camt = r.camt;
      det.samt = r.samt;
    }
    det.csamt = r.csamt;
    return { num: i + 1, itm_det: det };
  });
}

export interface Gstr1Row {
  section: string;
  number: string;
  date: string;
  party: string;
  gstin: string;
  pos: string;
  rateBp: number;
  noteType: string;
  tax: Tax;
}

export interface Gstr1Result {
  rows: Gstr1Row[];
  summary: Record<string, { count: number; tax: Tax }>;
  b2cs: Array<{ splyTy: "INTRA" | "INTER"; pos: string; rateBp: number; tax: Tax }>;
  hsn: { b2b: HsnRow[]; b2c: HsnRow[] };
  nil: Array<{ splyTy: string; exempt: number; nil: number; nonGst: number }>;
  docIssue: Array<{ docNum: number; label: string; from: string; to: string; total: number; cancelled: number; net: number }>;
  totals: Tax;
  payload: Record<string, unknown>;
}

export interface HsnRow { hsn: string; description: string; uqc: string; qty: number; rateBp: number; tax: Tax }

export interface Gstr1Input {
  gstin: string;
  fp: string;
  businessState: string;
  sales: RSale[];
  /** Every document number issued in the period, including cancelled ones. */
  issued: Array<{ docType: string; number: string; status: string }>;
}

const SECTIONS = ["b2b", "b2cl", "b2cs", "exp", "cdnr", "cdnur"] as const;

export function buildGstr1(input: Gstr1Input): Gstr1Result {
  const rows: Gstr1Row[] = [];
  const summary: Gstr1Result["summary"] = Object.fromEntries(SECTIONS.map((s) => [s, { count: 0, tax: zeroTax() }]));
  const totals = zeroTax();
  const b2csMap = new Map<string, { splyTy: "INTRA" | "INTER"; pos: string; rateBp: number; tax: Tax }>();
  const hsnMap = { b2b: new Map<string, HsnRow>(), b2c: new Map<string, HsnRow>() };
  const nilMap = new Map<string, { splyTy: string; exempt: number; nil: number; nonGst: number }>();
  for (const k of ["INTRB2B", "INTRAB2B", "INTRB2C", "INTRAB2C"]) nilMap.set(k, { splyTy: k, exempt: 0, nil: 0, nonGst: 0 });

  const b2b = new Map<string, unknown[]>();
  const b2cl = new Map<string, unknown[]>();
  const exp = { WPAY: [] as unknown[], WOPAY: [] as unknown[] };
  const cdnr = new Map<string, unknown[]>();
  const cdnur: unknown[] = [];

  for (const s of input.sales) {
    const sign = signOf(s.docType);
    const intra = !s.isExport && s.placeOfSupply === input.businessState;
    const registered = !!s.partyGstin;
    const taxableLines = s.lines.filter((l) => TAXABLE.has(l.supplyKind));
    const docTax = zeroTax();
    for (const l of taxableLines) addLine(docTax, l, 1);
    addTax(totals, docTax, sign);

    // Nil / exempt / non-GST table and HSN summary use every line.
    for (const l of s.lines) {
      if (!TAXABLE.has(l.supplyKind)) {
        const key = `${intra ? "INTRA" : "INTR"}${registered ? "B2B" : "B2C"}`;
        const n = nilMap.get(key)!;
        if (l.supplyKind === "exempt") n.exempt += sign * l.taxableValue;
        else if (l.supplyKind === "nil") n.nil += sign * l.taxableValue;
        else n.nonGst += sign * l.taxableValue;
      }
      const map = registered ? hsnMap.b2b : hsnMap.b2c;
      const uqc = (l.unit || "OTH").toUpperCase();
      const key = `${l.hsnSac}|${l.gstRateBp}|${uqc}`;
      const h = map.get(key) ?? { hsn: l.hsnSac, description: l.description, uqc, qty: 0, rateBp: l.gstRateBp, tax: zeroTax() };
      h.qty += sign * Number(l.qty);
      addLine(h.tax, l, sign);
      map.set(key, h);
    }

    if (!taxableLines.length) continue;
    const section = s.section;
    summary[section] ??= { count: 0, tax: zeroTax() };
    summary[section].count += 1;
    addTax(summary[section].tax, docTax, section === "b2cs" ? sign : 1);
    for (const it of itemsByRate(taxableLines)) {
      rows.push({
        section, number: s.number, date: s.date, party: s.partyName, gstin: s.partyGstin, pos: s.placeOfSupply,
        rateBp: it.rateBp, noteType: s.docType === "invoice" ? "" : s.docType === "credit_note" ? "C" : "D", tax: it.tax,
      });
    }

    const val = toRupees(s.grandTotal);
    const idt = portalDate(s.date);
    if (section === "b2b") {
      const list = b2b.get(s.partyGstin) ?? [];
      list.push({ inum: s.number, idt, val, pos: s.placeOfSupply, rchrg: s.reverseCharge ? "Y" : "N", inv_typ: "R", itms: portalItems(taxableLines, intra) });
      b2b.set(s.partyGstin, list);
    } else if (section === "b2cl") {
      const list = b2cl.get(s.placeOfSupply) ?? [];
      list.push({ inum: s.number, idt, val, itms: portalItems(taxableLines, false) });
      b2cl.set(s.placeOfSupply, list);
    } else if (section === "exp") {
      const typ = s.exportWithIgst ? "WPAY" : "WOPAY";
      exp[typ].push({
        inum: s.number, idt, val,
        itms: itemsByRate(taxableLines).map((it) => ({ txval: toRupees(it.tax.txval), rt: pct(it.rateBp), iamt: toRupees(it.tax.iamt), csamt: toRupees(it.tax.csamt) })),
      });
    } else if (section === "cdnr") {
      const list = cdnr.get(s.partyGstin) ?? [];
      list.push({ ntty: s.docType === "credit_note" ? "C" : "D", nt_num: s.number, nt_dt: idt, val, pos: s.placeOfSupply, rchrg: s.reverseCharge ? "Y" : "N", inv_typ: "R", itms: portalItems(taxableLines, intra) });
      cdnr.set(s.partyGstin, list);
    } else if (section === "cdnur") {
      cdnur.push({
        typ: s.isExport ? (s.exportWithIgst ? "EXPWP" : "EXPWOP") : "B2CL",
        ntty: s.docType === "credit_note" ? "C" : "D", nt_num: s.number, nt_dt: idt, val, pos: s.placeOfSupply,
        itms: portalItems(taxableLines, false),
      });
    } else if (section === "b2cs") {
      for (const it of itemsByRate(taxableLines)) {
        const splyTy = intra ? "INTRA" : "INTER";
        const key = `${splyTy}|${s.placeOfSupply}|${it.rateBp}`;
        const b = b2csMap.get(key) ?? { splyTy, pos: s.placeOfSupply, rateBp: it.rateBp, tax: zeroTax() };
        addTax(b.tax, it.tax, sign);
        b2csMap.set(key, b);
      }
    }
  }

  const docIssue = ([["invoice", 1, "Invoices for outward supply"], ["debit_note", 4, "Debit notes"], ["credit_note", 5, "Credit notes"]] as const)
    .map(([type, docNum, label]) => {
      const list = input.issued.filter((d) => d.docType === type).map((d) => d.number).sort(naturalCompare);
      const cancelled = input.issued.filter((d) => d.docType === type && d.status === "cancelled").length;
      return { docNum, label, from: list[0] ?? "", to: list[list.length - 1] ?? "", total: list.length, cancelled, net: list.length - cancelled };
    })
    .filter((d) => d.total > 0);

  const b2cs = [...b2csMap.values()].sort((a, b) => a.pos.localeCompare(b.pos) || a.rateBp - b.rateBp);
  const hsn = {
    b2b: [...hsnMap.b2b.values()].sort((a, b) => a.hsn.localeCompare(b.hsn)),
    b2c: [...hsnMap.b2c.values()].sort((a, b) => a.hsn.localeCompare(b.hsn)),
  };
  const nil = [...nilMap.values()];
  const hsnPayload = (list: HsnRow[]) => list.map((h, i) => {
    const r = rupeeTax(h.tax);
    return { num: i + 1, hsn_sc: h.hsn, desc: h.description.slice(0, 30), uqc: h.uqc, qty: Math.round(h.qty * 1000) / 1000, rt: pct(h.rateBp), txval: r.txval, iamt: r.iamt, camt: r.camt, samt: r.samt, csamt: r.csamt };
  });

  const payload: Record<string, unknown> = {
    gstin: input.gstin,
    fp: input.fp,
    version: "GST3.2.1",
    hash: "hash",
    b2b: [...b2b.entries()].map(([ctin, inv]) => ({ ctin, inv })),
    b2ba: [],
    b2cl: [...b2cl.entries()].map(([pos, inv]) => ({ pos, inv })),
    b2cla: [],
    b2cs: b2cs.map((b) => {
      const r = rupeeTax(b.tax);
      const row: Record<string, unknown> = { sply_ty: b.splyTy, pos: b.pos, typ: "OE", txval: r.txval, rt: pct(b.rateBp) };
      if (b.splyTy === "INTER") row.iamt = r.iamt;
      else {
        row.camt = r.camt;
        row.samt = r.samt;
      }
      row.csamt = r.csamt;
      return row;
    }),
    exp: (["WPAY", "WOPAY"] as const).filter((k) => exp[k].length).map((k) => ({ exp_typ: k, inv: exp[k] })),
    cdnr: [...cdnr.entries()].map(([ctin, nt]) => ({ ctin, nt })),
    cdnra: [],
    cdnur,
    nil: { inv: nil.map((n) => ({ sply_ty: n.splyTy, expt_amt: toRupees(n.exempt), nil_amt: toRupees(n.nil), ngsup_amt: toRupees(n.nonGst) })) },
    hsn: { hsn_b2b: hsnPayload(hsn.b2b), hsn_b2c: hsnPayload(hsn.b2c) },
    doc_issue: {
      doc_det: docIssue.map((d) => ({ doc_num: d.docNum, docs: [{ num: 1, from: d.from, to: d.to, totnum: d.total, cancel: d.cancelled, net_issue: d.net }] })),
    },
  };

  return { rows, summary, b2cs, hsn, nil, docIssue, totals, payload };
}

export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}

// ---- GSTR-3B -----------------------------------------------------------------

export interface ItcAdj { kind: "reversal" | "reclaim"; rule: string; igst: number; cgst: number; sgst: number; cess: number }

export interface Heads { igst: number; cgst: number; sgst: number; cess: number }
export const zeroHeads = (): Heads => ({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
const headsOf = (t: Tax): Heads => ({ igst: t.iamt, cgst: t.camt, sgst: t.samt, cess: t.csamt });

export const BLOCKED_REASON = "Blocked under section 17(5)";

export interface SetOffResult {
  liability: Heads;
  rcm: Heads;
  credit: Heads;
  /** paidByItc[liabilityHead][creditHead] */
  paidByItc: Record<keyof Heads, Heads>;
  cash: Heads;
  carryForward: Heads;
}

/**
 * Legal set-off order (s.49 / rule 88A): IGST credit → IGST, CGST, SGST;
 * CGST credit → CGST, IGST; SGST credit → SGST, IGST; cess → cess.
 * RCM liability is always paid in cash.
 */
export function setOff(liabilityIn: Heads, creditIn: Heads, rcm: Heads): SetOffResult {
  const clamp = (h: Heads): Heads => ({ igst: Math.max(0, h.igst), cgst: Math.max(0, h.cgst), sgst: Math.max(0, h.sgst), cess: Math.max(0, h.cess) });
  const liab = clamp(liabilityIn);
  const cr = clamp(creditIn);
  const paidByItc = { igst: zeroHeads(), cgst: zeroHeads(), sgst: zeroHeads(), cess: zeroHeads() };
  const apply = (c: keyof Heads, l: keyof Heads) => {
    const amt = Math.min(cr[c], liab[l]);
    cr[c] -= amt;
    liab[l] -= amt;
    paidByItc[l][c] += amt;
  };
  apply("igst", "igst"); apply("igst", "cgst"); apply("igst", "sgst");
  apply("cgst", "cgst"); apply("cgst", "igst");
  apply("sgst", "sgst"); apply("sgst", "igst");
  apply("cess", "cess");
  const r = clamp(rcm);
  return {
    liability: clamp(liabilityIn),
    rcm: r,
    credit: clamp(creditIn),
    paidByItc,
    cash: { igst: liab.igst + r.igst, cgst: liab.cgst + r.cgst, sgst: liab.sgst + r.sgst, cess: liab.cess + r.cess },
    carryForward: cr,
  };
}

export interface Gstr3bInput {
  gstin: string;
  fp: string;
  businessState: string;
  sales: RSale[];
  /** Purchases dated in the period (for 3.1(d) and table 5). */
  purchasesByDate: RPurchase[];
  /** Purchases whose ITC period is this period (for table 4). */
  purchasesByItc: RPurchase[];
  adjustments: ItcAdj[];
  interest: number;
  lateFee: number;
}

export interface Gstr3bResult {
  t31: { a: Tax; b: Tax; c: Tax; d: Tax; e: Tax };
  t32: Array<{ pos: string; txval: number; iamt: number }>;
  t4: { a3: Heads; a5: Heads; b1: Heads; b2: Heads; c: Heads; d1: Heads };
  t5: { gstInter: number; gstIntra: number; nonGstInter: number; nonGstIntra: number };
  payment: SetOffResult;
  interest: number;
  lateFee: number;
  payload: Record<string, unknown>;
}

function addHeads(a: Heads, b: Heads, sign = 1): void {
  a.igst += sign * b.igst;
  a.cgst += sign * b.cgst;
  a.sgst += sign * b.sgst;
  a.cess += sign * b.cess;
}

export function buildGstr3b(input: Gstr3bInput): Gstr3bResult {
  const t31 = { a: zeroTax(), b: zeroTax(), c: zeroTax(), d: zeroTax(), e: zeroTax() };
  const t32 = new Map<string, { pos: string; txval: number; iamt: number }>();

  for (const s of input.sales) {
    const sign = signOf(s.docType);
    const unregisteredInter = !s.partyGstin && !s.isExport && s.placeOfSupply !== input.businessState;
    for (const l of s.lines) {
      if (l.supplyKind === "taxable") {
        addLine(t31.a, l, sign);
        if (unregisteredInter) {
          const r = t32.get(s.placeOfSupply) ?? { pos: s.placeOfSupply, txval: 0, iamt: 0 };
          r.txval += sign * l.taxableValue;
          r.iamt += sign * l.igst;
          t32.set(s.placeOfSupply, r);
        }
      } else if (l.supplyKind === "zero_rated") addLine(t31.b, l, sign);
      else if (l.supplyKind === "nil" || l.supplyKind === "exempt") addLine(t31.c, l, sign);
      else addLine(t31.e, l, sign);
    }
  }

  const t5 = { gstInter: 0, gstIntra: 0, nonGstInter: 0, nonGstIntra: 0 };
  for (const p of input.purchasesByDate) {
    const sign = signOf(p.docType);
    const inter = p.supplierStateCode !== p.placeOfSupply;
    for (const l of p.lines) {
      if (p.reverseCharge && TAXABLE.has(l.supplyKind)) addLine(t31.d, l, sign);
      if (l.supplyKind === "nil" || l.supplyKind === "exempt") {
        if (inter) t5.gstInter += sign * l.taxableValue;
        else t5.gstIntra += sign * l.taxableValue;
      } else if (l.supplyKind === "non_gst") {
        if (inter) t5.nonGstInter += sign * l.taxableValue;
        else t5.nonGstIntra += sign * l.taxableValue;
      }
    }
  }

  const a3 = zeroHeads();
  const a5 = zeroHeads();
  const b1 = zeroHeads();
  const b2 = zeroHeads();
  const d1 = zeroHeads();
  for (const p of input.purchasesByItc) {
    const sign = signOf(p.docType);
    for (const l of p.lines) {
      const h = { igst: l.igst, cgst: l.cgst, sgst: l.sgst, cess: l.cess };
      const blocked = !l.itcEligible && l.itcReason === BLOCKED_REASON;
      if (!l.itcEligible && !blocked) continue; // never claimable: not reported
      addHeads(p.reverseCharge ? a3 : a5, h, sign);
      if (blocked) addHeads(b1, h, sign); // Circular 170/02/2022: show in 4A, reverse in 4B(1)
    }
  }
  for (const a of input.adjustments) {
    const h = { igst: a.igst, cgst: a.cgst, sgst: a.sgst, cess: a.cess };
    if (a.kind === "reclaim") {
      addHeads(a5, h);
      addHeads(d1, h);
    } else if (a.rule === "other") addHeads(b2, h);
    else addHeads(b1, h);
  }
  const c = zeroHeads();
  addHeads(c, a3);
  addHeads(c, a5);
  addHeads(c, b1, -1);
  addHeads(c, b2, -1);

  const liability = headsOf(t31.a);
  addHeads(liability, headsOf(t31.b));
  const payment = setOff(liability, c, headsOf(t31.d));

  const lateCgst = roundHalfUp(input.lateFee, 2);
  const lateSgst = input.lateFee - lateCgst;
  const hp = (h: Heads) => ({ iamt: toRupees(h.igst), camt: toRupees(h.cgst), samt: toRupees(h.sgst), csamt: toRupees(h.cess) });
  const t32list = [...t32.values()].sort((x, y) => x.pos.localeCompare(y.pos));

  const payload = {
    gstin: input.gstin,
    ret_period: input.fp,
    sup_details: {
      osup_det: rupeeTax(t31.a),
      osup_zero: { txval: toRupees(t31.b.txval), iamt: toRupees(t31.b.iamt), csamt: toRupees(t31.b.csamt) },
      osup_nil_exmp: { txval: toRupees(t31.c.txval) },
      isup_rev: rupeeTax(t31.d),
      osup_nongst: { txval: toRupees(t31.e.txval) },
    },
    inter_sup: {
      unreg_details: t32list.map((r) => ({ pos: r.pos, txval: toRupees(r.txval), iamt: toRupees(r.iamt) })),
      comp_details: [],
      uin_details: [],
    },
    itc_elg: {
      itc_avl: [
        { ty: "IMPG", ...hp(zeroHeads()) },
        { ty: "IMPS", ...hp(zeroHeads()) },
        { ty: "ISRC", ...hp(a3) },
        { ty: "ISD", ...hp(zeroHeads()) },
        { ty: "OTH", ...hp(a5) },
      ],
      itc_rev: [{ ty: "RUL", ...hp(b1) }, { ty: "OTH", ...hp(b2) }],
      itc_net: hp(c),
      itc_inelg: [{ ty: "RUL", ...hp(d1) }, { ty: "OTH", ...hp(zeroHeads()) }],
    },
    inward_sup: {
      isup_details: [
        { ty: "GST", inter: toRupees(t5.gstInter), intra: toRupees(t5.gstIntra) },
        { ty: "NONGST", inter: toRupees(t5.nonGstInter), intra: toRupees(t5.nonGstIntra) },
      ],
    },
    intr_ltfee: {
      intr_details: { iamt: 0, camt: 0, samt: 0, csamt: 0 },
      ltfee_details: { iamt: 0, camt: toRupees(lateCgst), samt: toRupees(lateSgst), csamt: 0 },
    },
  };

  return { t31, t32: t32list, t4: { a3, a5, b1, b2, c, d1 }, t5, payment, interest: input.interest, lateFee: input.lateFee, payload };
}

export interface CompareRow { head: string; gstr1: number; gstr3b: number; difference: number }

/** GSTR-1 outward tax vs GSTR-3B 3.1(a)+(b). They should agree; differences point to data issues. */
export function compare1vs3b(g1: Gstr1Result, g3: Gstr3bResult): CompareRow[] {
  const b3 = zeroTax();
  addTax(b3, g3.t31.a);
  addTax(b3, g3.t31.b);
  const heads: Array<[string, keyof Tax]> = [["Taxable value", "txval"], ["IGST", "iamt"], ["CGST", "camt"], ["SGST", "samt"], ["Cess", "csamt"]];
  return heads.map(([head, k]) => ({ head, gstr1: g1.totals[k], gstr3b: b3[k], difference: g1.totals[k] - b3[k] }));
}

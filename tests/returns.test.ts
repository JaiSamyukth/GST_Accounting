import { describe, expect, it } from "vitest";
import { calcDocument, type LineInput } from "@/lib/gst/gst";
import { BLOCKED_REASON, buildGstr1, buildGstr3b, compare1vs3b, setOff, type RLine, type RPurchase, type RSale } from "@/lib/gst/returns";

// Business in Tamil Nadu (33). One hand-computed month.
const STATE = "33";
const B2B = "33AAPFU0939F1Z1"; // shape only; the builders do not validate GSTINs

function lines(rupees: number, rateBp: number, intra: boolean, kind: LineInput["supplyKind"] = "taxable", isExport = false): RLine[] {
  const d = calcDocument([{
    description: "Catering", hsnSac: "996334", qtyMilli: 1000, unit: "OTH", unitPriceE4: rupees * 10000,
    discount: 0, gstRateBp: rateBp, cessRateBp: 0, supplyKind: kind,
  }], { intraState: intra, priceMode: "exclusive", isExport });
  return d.lines.map((l) => ({ ...l, qty: "1.000" }));
}

let id = 0;
function sale(p: Partial<RSale> & { lines: RLine[] }): RSale {
  const total = p.lines.reduce((s, l) => s + l.taxableValue + l.cgst + l.sgst + l.igst + l.cess, 0);
  return {
    id: ++id, docType: "invoice", number: `INV-${String(id).padStart(4, "0")}`, date: "2026-11-05", partyName: "Customer",
    partyGstin: "", placeOfSupply: STATE, reverseCharge: false, isExport: false, exportWithIgst: false, section: "b2cs",
    grandTotal: total, originalNumber: "", originalDate: null, ...p,
  };
}

function purchase(p: Partial<RPurchase> & { lines: RPurchase["lines"] }): RPurchase {
  return { id: ++id, docType: "invoice", number: `B${id}`, date: "2026-11-10", supplierGstin: "33XYZ", supplierStateCode: STATE, placeOfSupply: STATE, reverseCharge: false, ...p };
}
const eligible = (ls: RLine[]) => ls.map((l) => ({ ...l, itcEligible: true, itcReason: "" }));

const sales: RSale[] = [
  sale({ section: "b2b", partyGstin: B2B, lines: lines(100000, 500, true) }),                                    // S1
  sale({ lines: [...lines(20000, 500, true), ...lines(1000, 0, true, "nil")] }),                                // S2
  sale({ section: "b2cl", placeOfSupply: "29", lines: lines(150000, 1800, false) }),                             // S3
  sale({ section: "b2cs", placeOfSupply: "29", lines: lines(10000, 1800, false) }),                              // S4
  sale({ docType: "credit_note", number: "CN-0001", section: "cdnr", partyGstin: B2B, originalNumber: "INV-0001", lines: lines(10000, 500, true) }), // S5
  sale({ section: "exp", isExport: true, placeOfSupply: "96", lines: lines(50000, 1800, false, "taxable", true) }), // S6
];

const purchases: RPurchase[] = [
  purchase({ lines: eligible(lines(40000, 500, true)) }),                                            // P1
  purchase({ supplierStateCode: "29", lines: eligible(lines(10000, 1800, false)) }),                 // P2
  purchase({ lines: lines(2000, 1800, true).map((l) => ({ ...l, itcEligible: false, itcReason: BLOCKED_REASON })) }), // P3
  purchase({ reverseCharge: true, lines: eligible(lines(5000, 1800, true)) }),                       // P4 RCM
  purchase({ supplierGstin: "", lines: lines(3000, 500, true).map((l) => ({ ...l, itcEligible: false, itcReason: "Supplier is unregistered" })) }), // P5
];

const issued = sales.map((s) => ({ docType: s.docType, number: s.number, status: "active" }));
const g1 = buildGstr1({ gstin: "33AAPFU0939F1Z1", fp: "112026", businessState: STATE, sales, issued: [...issued, { docType: "invoice", number: "INV-0099", status: "cancelled" }] });
const g3 = buildGstr3b({
  gstin: "33AAPFU0939F1Z1", fp: "112026", businessState: STATE, sales, purchasesByDate: purchases, purchasesByItc: purchases,
  adjustments: [{ kind: "reversal", rule: "rule_42", igst: 0, cgst: 5000, sgst: 5000, cess: 0 }], interest: 0, lateFee: 5000,
});

describe("GSTR-1", () => {
  it("classifies sections and sums them", () => {
    expect(g1.summary.b2b).toEqual({ count: 1, tax: { txval: 10000000, iamt: 0, camt: 250000, samt: 250000, csamt: 0 } });
    expect(g1.summary.b2cl.tax.iamt).toBe(2700000);
    expect(g1.summary.cdnr.tax.txval).toBe(1000000);
    expect(g1.summary.exp.tax).toEqual({ txval: 5000000, iamt: 0, camt: 0, samt: 0, csamt: 0 });
  });

  it("groups B2CS by supply type, POS and rate", () => {
    expect(g1.b2cs).toEqual([
      { splyTy: "INTER", pos: "29", rateBp: 1800, tax: { txval: 1000000, iamt: 180000, camt: 0, samt: 0, csamt: 0 } },
      { splyTy: "INTRA", pos: "33", rateBp: 500, tax: { txval: 2000000, iamt: 0, camt: 50000, samt: 50000, csamt: 0 } },
    ]);
  });

  it("builds the nil table, document summary and totals", () => {
    expect(g1.nil.find((n) => n.splyTy === "INTRAB2C")?.nil).toBe(100000);
    expect(g1.docIssue).toEqual([
      { docNum: 1, label: "Invoices for outward supply", from: "INV-0001", to: "INV-0099", total: 6, cancelled: 1, net: 5 },
      { docNum: 5, label: "Credit notes", from: "CN-0001", to: "CN-0001", total: 1, cancelled: 0, net: 1 },
    ]);
    expect(g1.totals.txval).toBe(32000000);
  });

  it("produces the portal payload in rupees", () => {
    const p = g1.payload as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(Object.keys(p)).toEqual(["gstin", "fp", "version", "hash", "b2b", "b2ba", "b2cl", "b2cla", "b2cs", "exp", "cdnr", "cdnra", "cdnur", "nil", "hsn", "doc_issue"]);
    expect(p.b2b[0].ctin).toBe(B2B);
    expect(p.b2b[0].inv[0]).toMatchObject({ inum: "INV-0001", idt: "05-11-2026", val: 105000, pos: "33", rchrg: "N" });
    expect(p.b2b[0].inv[0].itms[0].itm_det).toEqual({ txval: 100000, rt: 5, iamt: 0, camt: 2500, samt: 2500, csamt: 0 });
    expect(p.b2cl[0]).toMatchObject({ pos: "29" });
    expect(p.exp[0].exp_typ).toBe("WOPAY");
    expect(p.cdnr[0].nt[0]).toMatchObject({ ntty: "C", nt_num: "CN-0001", val: 10500 });
  });
});

describe("GSTR-3B", () => {
  it("table 3.1 and 3.2", () => {
    expect(g3.t31.a).toEqual({ txval: 27000000, iamt: 2880000, camt: 275000, samt: 275000, csamt: 0 });
    expect(g3.t31.b.txval).toBe(5000000);
    expect(g3.t31.c.txval).toBe(100000);
    expect(g3.t31.d).toEqual({ txval: 500000, iamt: 0, camt: 45000, samt: 45000, csamt: 0 });
    expect(g3.t32).toEqual([{ pos: "29", txval: 16000000, iamt: 2880000 }]);
  });

  it("table 4: blocked ITC shown in 4A(5) and reversed in 4B(1); unregistered bill not reported", () => {
    expect(g3.t4.a3).toEqual({ igst: 0, cgst: 45000, sgst: 45000, cess: 0 });
    expect(g3.t4.a5).toEqual({ igst: 180000, cgst: 118000, sgst: 118000, cess: 0 });
    expect(g3.t4.b1).toEqual({ igst: 0, cgst: 23000, sgst: 23000, cess: 0 });
    expect(g3.t4.c).toEqual({ igst: 180000, cgst: 140000, sgst: 140000, cess: 0 });
  });

  it("6.1 payment follows the set-off order; RCM is cash", () => {
    expect(g3.payment.cash).toEqual({ igst: 2700000, cgst: 180000, sgst: 180000, cess: 0 });
    expect(g3.payment.carryForward).toEqual({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
  });

  it("splits the late fee between CGST and SGST", () => {
    expect((g3.payload as { intr_ltfee: { ltfee_details: object } }).intr_ltfee.ltfee_details).toEqual({ iamt: 0, camt: 25, samt: 25, csamt: 0 });
  });

  it("agrees with GSTR-1", () => {
    expect(compare1vs3b(g1, g3).every((r) => r.difference === 0)).toBe(true);
  });
});

describe("setOff", () => {
  it("uses IGST credit across CGST then SGST before CGST/SGST credit", () => {
    const r = setOff({ igst: 1000, cgst: 5000, sgst: 5000, cess: 0 }, { igst: 8000, cgst: 1000, sgst: 0, cess: 0 }, { igst: 0, cgst: 0, sgst: 0, cess: 0 });
    // IGST credit 8000: 1000 → IGST, 5000 → CGST, 2000 → SGST. CGST credit then has no CGST/IGST liability left.
    expect(r.paidByItc.igst.igst).toBe(1000);
    expect(r.paidByItc.cgst.igst).toBe(5000);
    expect(r.paidByItc.sgst.igst).toBe(2000);
    expect(r.cash).toEqual({ igst: 0, cgst: 0, sgst: 3000, cess: 0 });
    expect(r.carryForward).toEqual({ igst: 0, cgst: 1000, sgst: 0, cess: 0 });
  });

  it("CGST credit can pay IGST but never SGST", () => {
    const r = setOff({ igst: 3000, cgst: 0, sgst: 2000, cess: 0 }, { igst: 0, cgst: 5000, sgst: 0, cess: 0 }, { igst: 0, cgst: 0, sgst: 0, cess: 0 });
    expect(r.paidByItc.igst.cgst).toBe(3000);
    expect(r.cash.sgst).toBe(2000);
    expect(r.carryForward.cgst).toBe(2000);
  });
});

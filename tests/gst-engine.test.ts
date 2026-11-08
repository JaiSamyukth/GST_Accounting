import { describe, expect, it } from "vitest";
import { calcDocument, calcLine, classifySalesDoc, GstValidationError, type LineInput } from "@/lib/gst/gst";

function line(p: Partial<LineInput>): LineInput {
  return {
    description: "Item", hsnSac: "996334", qtyMilli: 1000, unit: "NOS", unitPriceE4: 0,
    discount: 0, gstRateBp: 500, cessRateBp: 0, supplyKind: "taxable", ...p,
  };
}
const intra = { intraState: true, priceMode: "exclusive" as const };
const inter = { intraState: false, priceMode: "exclusive" as const };

describe("calcLine", () => {
  it("5% catering, intra-state: 100 plates @ ₹250", () => {
    const r = calcLine(line({ qtyMilli: 100_000, unitPriceE4: 2_500_000 }), intra);
    expect(r.taxableValue).toBe(2_500_000);
    expect(r.cgst).toBe(62_500);
    expect(r.sgst).toBe(62_500);
    expect(r.igst).toBe(0);
    expect(r.total).toBe(2_625_000);
  });

  it("18% inclusive ₹1000: taxable 847.46, CGST 76.27 each", () => {
    const r = calcLine(line({ unitPriceE4: 10_000_000, gstRateBp: 1800 }), { intraState: true, priceMode: "inclusive" });
    expect(r.taxableValue).toBe(84_746);
    expect(r.cgst).toBe(7_627);
    expect(r.sgst).toBe(7_627);
    expect(r.total).toBe(100_000);
  });

  it("18% inclusive ₹999 absorbs the residual paisa into taxable value", () => {
    // 99900 × 10000 / 11800 = 84661.02 -> 84661; CGST 7619.49 -> 7619 ×2; sum 99899; +1 residual
    const r = calcLine(line({ unitPriceE4: 9_990_000, gstRateBp: 1800 }), { intraState: true, priceMode: "inclusive" });
    expect(r.taxableValue).toBe(84_662);
    expect(r.cgst + r.sgst).toBe(15_238);
    expect(r.total).toBe(99_900);
  });

  it("discount, 12% inter-state: 10 @ ₹105.50 less ₹55", () => {
    const r = calcLine(line({ qtyMilli: 10_000, unitPriceE4: 1_055_000, discount: 5_500, gstRateBp: 1200 }), inter);
    expect(r.gross).toBe(105_500);
    expect(r.taxableValue).toBe(100_000);
    expect(r.igst).toBe(12_000);
    expect(r.total).toBe(112_000);
  });

  it("cess: ₹1000 at 28% + 12% cess, inter-state", () => {
    const r = calcLine(line({ unitPriceE4: 10_000_000, gstRateBp: 2800, cessRateBp: 1200 }), inter);
    expect(r.igst).toBe(28_000);
    expect(r.cess).toBe(12_000);
    expect(r.total).toBe(140_000);
  });

  it("zero-rated export without and with IGST", () => {
    const l = line({ unitPriceE4: 500_000_000, gstRateBp: 1800 });
    const wopay = calcLine(l, { ...intra, isExport: true });
    expect(wopay.supplyKind).toBe("zero_rated");
    expect(wopay.gstRateBp).toBe(0);
    expect(wopay.igst).toBe(0);
    expect(wopay.total).toBe(5_000_000);
    const wpay = calcLine(l, { ...intra, isExport: true, exportWithIgst: true });
    expect(wpay.cgst).toBe(0);
    expect(wpay.igst).toBe(900_000);
  });

  it("non-taxable kinds force rate 0", () => {
    for (const kind of ["exempt", "nil", "non_gst"] as const) {
      const r = calcLine(line({ unitPriceE4: 10_000_000, gstRateBp: 1800, cessRateBp: 100, supplyKind: kind }), intra);
      expect(r.gstRateBp).toBe(0);
      expect(r.cgst + r.sgst + r.igst + r.cess).toBe(0);
      expect(r.total).toBe(100_000);
    }
  });

  it("sub-paisa rounding is half-up per component", () => {
    // 3 × ₹0.3333 = 99.99 paise -> 100; 2.5% of 100 = 2.5 -> 3 each
    const r = calcLine(line({ qtyMilli: 3_000, unitPriceE4: 3_333 }), intra);
    expect(r.taxableValue).toBe(100);
    expect(r.cgst).toBe(3);
    expect(r.sgst).toBe(3);
    // 2.5 kg × ₹123.4567 = ₹308.64175 -> 30864 paise
    expect(calcLine(line({ qtyMilli: 2_500, unitPriceE4: 1_234_567 }), intra).taxableValue).toBe(30_864);
  });

  it("rejects bad input", () => {
    expect(() => calcLine(line({ qtyMilli: 0 }), intra)).toThrow(GstValidationError);
    expect(() => calcLine(line({ unitPriceE4: 1000, discount: 999 }), intra)).toThrow(/discount/);
    expect(() => calcLine(line({ gstRateBp: -1 }), intra)).toThrow(GstValidationError);
  });
});

describe("calcDocument", () => {
  it("totals, buckets and round off up", () => {
    // ₹1000 @5% = 1050; ₹0.50 @0% exempt -> 1050.50 -> rounds to 1051
    const d = calcDocument(
      [line({ unitPriceE4: 10_000_000 }), line({ unitPriceE4: 5_000, supplyKind: "exempt" })],
      { ...intra, roundOff: true },
    );
    expect(d.total).toBe(105_050);
    expect(d.grandTotal).toBe(105_100);
    expect(d.roundOff).toBe(50);
    expect(d.byKind.exempt.taxableValue).toBe(50);
    expect(d.byRate.map((b) => b.gstRateBp)).toEqual([0, 500]);
  });

  it("round off down", () => {
    const d = calcDocument([line({ unitPriceE4: 10_000_000, gstRateBp: 0 }), line({ unitPriceE4: 4_900, gstRateBp: 0 })], { ...intra, roundOff: true });
    expect(d.total).toBe(100_049);
    expect(d.roundOff).toBe(-49);
    expect(d.grandTotal).toBe(100_000);
  });

  it("requires a line", () => {
    expect(() => calcDocument([], intra)).toThrow(GstValidationError);
  });
});

describe("classifySalesDoc", () => {
  const base = { docType: "invoice" as const, partyGstin: null, placeOfSupply: "33", businessState: "33", isExport: false, invoiceValue: 50_000_00, b2clLimit: 1_00_000_00 };
  it("classifies invoices", () => {
    expect(classifySalesDoc({ ...base, partyGstin: "33ABCDE1234F1Z5" })).toBe("b2b");
    expect(classifySalesDoc(base)).toBe("b2cs");
    expect(classifySalesDoc({ ...base, placeOfSupply: "29", invoiceValue: 1_00_000_01 })).toBe("b2cl");
    expect(classifySalesDoc({ ...base, placeOfSupply: "29", invoiceValue: 1_00_000_00 })).toBe("b2cs");
    expect(classifySalesDoc({ ...base, invoiceValue: 5_00_000_00 })).toBe("b2cs");
    expect(classifySalesDoc({ ...base, isExport: true, placeOfSupply: "96" })).toBe("exp");
  });
  it("classifies notes", () => {
    expect(classifySalesDoc({ ...base, docType: "credit_note", partyGstin: "33ABCDE1234F1Z5" })).toBe("cdnr");
    expect(classifySalesDoc({ ...base, docType: "credit_note" })).toBe("b2cs");
    expect(classifySalesDoc({ ...base, docType: "debit_note", isExport: true })).toBe("cdnur");
  });
});

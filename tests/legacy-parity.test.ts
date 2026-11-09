// The earlier FastAPI app's test suite (backend/tests in git history), ported so the rebuild
// is held to the same figures. Rupee amounts from the old tests are written here in paise.
import { zipSync, strToU8 } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import * as setup from "@/app/api/auth/setup/route";
import * as businessApi from "@/app/api/business/route";
import * as calcApi from "@/app/api/gst/calculate/route";
import * as salesApi from "@/app/api/sales/route";
import * as saleApi from "@/app/api/sales/[id]/route";
import * as amendApi from "@/app/api/sales/[id]/amend/route";
import * as nextNumber from "@/app/api/sales/next-number/route";
import * as purchasesApi from "@/app/api/purchases/route";
import * as itcPurchase from "@/app/api/itc/purchases/[id]/route";
import * as gstr2b from "@/app/api/itc/gstr2b/route";
import * as recon from "@/app/api/itc/recon/[period]/route";
import * as returnApi from "@/app/api/returns/[key]/route";
import * as returnFile from "@/app/api/returns/[key]/[file]/route";
import * as approve from "@/app/api/returns/[key]/approve/route";
import * as filed from "@/app/api/returns/[key]/filed/route";
import * as unlock from "@/app/api/returns/[key]/unlock/route";
import * as preview from "@/app/api/imports/preview/route";
import * as commit from "@/app/api/imports/commit/route";
import * as errorReport from "@/app/api/imports/error-report/route";
import * as docs from "@/app/api/documents/route";
import * as partiesApi from "@/app/api/parties/route";
import { calcDocument, calcLine, classifySalesDoc, type LineInput } from "@/lib/gst/gst";
import { checkGstin, gstinCheckChar, stateFromGstin } from "@/lib/gst/gstin";
import { dueDates, fyLabel, fyStartYear, periodOf, periodRange, periodsForFy } from "@/lib/gst/periods";
import { setOff } from "@/lib/gst/returns";
import { similarNumbers } from "@/lib/gst/recon";
import { bumpNumber } from "@/lib/docs";
import { memoryStorage, setStorage } from "@/lib/storage";
import { Client, freshDb, gstin, OWNER } from "./helpers";

const GSTIN_TN = gstin("33", "AAPFU0939F");
const GSTIN_KA = gstin("29", "AABCK1234L");

// ---- test_gst_engine.py ------------------------------------------------------

const L = (qty: number, rupees: number, ratePct: number, o: Partial<LineInput> = {}): LineInput => ({
  description: "x", hsnSac: "996334", qtyMilli: Math.round(qty * 1000), unit: "NOS", unitPriceE4: Math.round(rupees * 10000),
  discount: 0, gstRateBp: Math.round(ratePct * 100), cessRateBp: 0, supplyKind: "taxable", ...o,
});
const intra = { intraState: true, priceMode: "exclusive" as const };

describe("old test_gst_engine.py", () => {
  it("GSTIN checksum, format and state", () => {
    expect(checkGstin("27AAPFU0939F1ZV").valid).toBe(true);
    expect(stateFromGstin("33AAPFU0939F1Z2")).toBe("33");
    expect(checkGstin("27AAPFU0939F1ZA").errors.join()).toMatch(/checksum/i);
    expect(checkGstin("27AAPFU0939F1Z").valid).toBe(false);
    expect(checkGstin("99AAPFU0939F1ZV").valid).toBe(false);
    expect(gstinCheckChar("27AAPFU0939F1Z")).toBe("V");
  });

  it("intra-state exclusive splits CGST/SGST: 100 × ₹250 @5%", () => {
    const r = calcLine(L(100, 250, 5), intra);
    expect([r.taxableValue, r.cgst, r.sgst, r.igst, r.total]).toEqual([2500000, 62500, 62500, 0, 2625000]);
  });

  it("inter-state uses IGST: ₹1000 @18% = ₹180", () => {
    const r = calcLine(L(1, 1000, 18), { ...intra, intraState: false });
    expect([r.igst, r.cgst]).toEqual([18000, 0]);
  });

  it("discount reduces taxable value: 10 × ₹100 − ₹100 @5%", () => {
    const r = calcLine(L(10, 100, 5, { discount: 10000 }), intra);
    expect([r.taxableValue, r.cgst]).toEqual([90000, 2250]);
  });

  it("inclusive ₹1050 @5% back-calculates to ₹1000 + 25 + 25", () => {
    const r = calcLine(L(1, 1050, 5), { ...intra, priceMode: "inclusive" });
    expect([r.taxableValue, r.cgst, r.sgst, r.total]).toEqual([100000, 2500, 2500, 105000]);
  });

  it("inclusive odd amount keeps the total equal to the gross: 3 × ₹333.33 @18%", () => {
    const r = calcLine(L(3, 333.33, 18), { ...intra, priceMode: "inclusive" });
    expect(r.total).toBe(99999);
    expect(r.cgst).toBe(r.sgst);
    expect(r.taxableValue + r.cgst + r.sgst).toBe(99999);
  });

  it.each(["exempt", "nil", "non_gst"] as const)("%s carries no tax", (kind) => {
    const r = calcLine(L(2, 50, 5, { supplyKind: kind }), intra);
    expect([r.gstRateBp, r.cgst, r.sgst, r.igst, r.total]).toEqual([0, 0, 0, 0, 10000]);
  });

  it("half-up rounding to the paisa", () => {
    expect(calcLine(L(1, 10.1, 5), intra).cgst).toBe(25); // 0.2525 -> 0.25
    expect(calcLine(L(1, 10.3, 5), intra).cgst).toBe(26); // 0.2575 -> 0.26
  });

  it("document totals, rate break-up and round off", () => {
    const d = calcDocument([L(150, 180, 5), L(1, 1500.5, 5), L(1, 500, 18, { hsnSac: "996601" })], { ...intra, roundOff: true });
    expect(d.taxableValue).toBe(2900050);
    expect(d.cgst).toBe(67500 + 3751 + 4500);
    expect(d.byRate.find((b) => b.gstRateBp === 500)?.taxableValue).toBe(2850050);
    expect(d.roundOff).toBe(d.grandTotal - d.total);
    expect(d.grandTotal % 100).toBe(0);
  });

  it("classifies sales documents", () => {
    const c = (docType: "invoice" | "credit_note", partyGstin: string | null, inter: boolean, totalRupees: number, limitRupees: number, isExport = false) =>
      classifySalesDoc({ docType, partyGstin, placeOfSupply: inter ? "29" : "33", businessState: "33", isExport, invoiceValue: totalRupees * 100, b2clLimit: limitRupees * 100 });
    expect(c("invoice", "33AAPFU0939F1Z2", false, 10, 100000)).toBe("b2b");
    expect(c("invoice", null, true, 100001, 100000)).toBe("b2cl");
    expect(c("invoice", null, true, 100000, 100000)).toBe("b2cs");
    expect(c("invoice", null, false, 900000, 100000)).toBe("b2cs");
    expect(c("invoice", null, true, 5, 1, true)).toBe("exp");
    expect(c("credit_note", "33AAPFU0939F1Z2", false, 5, 1)).toBe("cdnr");
    expect(c("credit_note", null, true, 150000, 100000)).toBe("cdnur");
    expect(c("credit_note", null, false, 5, 1)).toBe("b2cs");
  });
});

// ---- test_periods.py / test_setoff.py ----------------------------------------

describe("old test_periods.py", () => {
  it("FY and period keys", () => {
    expect(fyLabel(fyStartYear("2026-03-31"))).toBe("2025-26");
    expect(fyLabel(fyStartYear("2026-04-01"))).toBe("2026-27");
    expect(periodOf("2026-10-05", "monthly")).toBe("2026-10");
    expect(periodOf("2027-02-01", "quarterly")).toBe("2026-Q4");
    expect(periodOf("2026-04-01", "quarterly")).toBe("2026-Q1");
  });

  it("ranges, return period, FY list and due date", () => {
    expect(periodRange("2026-02")).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange("2026-Q3")).toMatchObject({ from: "2026-10-01", to: "2026-12-31", fp: "122026" });
    expect(periodRange("2026-Q4")).toMatchObject({ from: "2027-01-01", to: "2027-03-31" });
    const fy = periodsForFy(2026, "monthly");
    expect([fy[0], fy[fy.length - 1]]).toEqual(["2026-04", "2027-03"]);
    expect(dueDates("2026-10").gstr1).toBe("2026-11-11");
  });
});

describe("old test_setoff.py", () => {
  const h = (igst = 0, cgst = 0, sgst = 0, cess = 0) => ({ igst, cgst, sgst, cess });
  it("IGST credit goes to IGST, then CGST, then SGST", () => {
    const r = setOff(h(100, 50, 50), h(180), h());
    expect([r.paidByItc.igst.igst, r.paidByItc.cgst.igst, r.paidByItc.sgst.igst]).toEqual([100, 50, 30]);
    expect(r.cash).toEqual(h(0, 0, 20));
    expect(r.carryForward).toEqual(h());
  });
  it("CGST credit cannot pay SGST", () => {
    const r = setOff(h(0, 10, 100), h(0, 100), h());
    expect([r.cash.sgst, r.cash.cgst, r.carryForward.cgst]).toEqual([100, 0, 90]);
  });
  it("CGST credit pays IGST after CGST", () => {
    const r = setOff(h(40, 10, 0), h(0, 30, 5), h());
    expect([r.paidByItc.igst.cgst, r.paidByItc.cgst.cgst, r.paidByItc.igst.sgst, r.cash.igst]).toEqual([20, 10, 5, 15]);
  });
  it("cess only with cess", () => {
    const r = setOff(h(0, 0, 0, 10), h(100, 0, 0, 4), h());
    expect([r.cash.cess, r.carryForward.igst]).toEqual([6, 100]);
  });
});

describe("helpers added for parity", () => {
  it("continues the user's numbering", () => {
    expect(bumpNumber("DC/26-27/009")).toBe("DC/26-27/010");
    expect(bumpNumber("INV-0099")).toBe("INV-0100");
    expect(bumpNumber("A1B")).toBe("A2B");
    expect(bumpNumber("ABC")).toBeNull();
  });
  it("treats near-identical invoice numbers as probable, unrelated ones not", () => {
    expect(similarNumbers("SMP/1190", "SMP-1190")).toBe(true);
    expect(similarNumbers("SMP/1190", "SMP/119O")).toBe(true);
    expect(similarNumbers("SMP/1190", "SMP/2000")).toBe(false);
  });
});

// ---- test_api_flow.py ----------------------------------------------------------

const CATER = { description: "Outdoor catering, wedding lunch", hsnSac: "996334", qty: "150", unit: "NOS", unitPrice: "180", gstRateBp: 500 };
const c = new Client();
const text = (d: unknown) => Buffer.from(d as ArrayBuffer).toString("utf8");

async function sale(number: string, o: Record<string, unknown> = {}) {
  const r = await c.call(salesApi.POST, { body: { number, date: "2026-10-15", partyName: "Maria Weddings", placeOfSupply: "33", lines: [CATER], ...o } });
  expect(r.status, JSON.stringify(r.data)).toBe(201);
  return r.data.sale;
}
const bill = (number: string, supplierName: string, supplierGstin: string, line: Record<string, unknown>, o: Record<string, unknown> = {}) =>
  c.call(purchasesApi.POST, { body: { number, date: "2026-10-05", supplierName, supplierGstin, supplierStateCode: supplierGstin ? supplierGstin.slice(0, 2) : "33", lines: [{ description: "x", qty: "1", ...line }], ...o } });

describe("old test_api_flow.py", () => {
  beforeEach(async () => {
    await freshDb();
    setStorage(memoryStorage());
    c.cookie = "";
    await c.call(setup.POST, { body: { ...OWNER, businessName: "Dev Caters", stateCode: "33" } });
    await c.call(businessApi.PUT, { method: "PUT", body: { legalName: "Dev Caters", gstin: "33AAPFU0939F1Z2".slice(0, 14) + gstinCheckChar("33AAPFU0939F1Z"), stateCode: "33", filingFrequency: "monthly", fyStartYear: 2026 } });
  });

  it("GSTIN validation on business and sales", async () => {
    const r = await c.call(businessApi.PUT, { method: "PUT", body: { legalName: "X", gstin: "33AAPFU0939F1ZX", stateCode: "33", filingFrequency: "monthly", fyStartYear: 2026 } });
    expect(r.status).toBe(422);
    expect(r.data.error).toMatch(/checksum/);
    expect((await c.call(salesApi.POST, { body: { number: "X1", date: "2026-10-01", partyName: "A", partyGstin: "BAD", placeOfSupply: "33", lines: [CATER] } })).status).toBe(422);
  });

  it("classification, tax, duplicates and the next number", async () => {
    const a = await sale("DC/26-27/001");
    expect(a).toMatchObject({ section: "b2cs", cgst: 67500, grandTotal: 2835000 });
    expect((await sale("DC/26-27/002", { partyGstin: GSTIN_TN })).section).toBe("b2b");
    const b2cl = await sale("DC/26-27/003", { placeOfSupply: "29", lines: [{ ...CATER, qty: "1000" }] });
    expect(b2cl).toMatchObject({ section: "b2cl", igst: 900000, cgst: 0 });
    expect((await c.call(salesApi.POST, { body: { number: "DC/26-27/001", date: "2026-10-15", partyName: "X", placeOfSupply: "33", lines: [CATER] } })).status).toBe(409);
    expect((await c.call(nextNumber.GET)).data.number).toBe("DC/26-27/004");
    expect((await c.call(salesApi.GET, { path: "/api/sales?period=2026-10" })).data.total).toBe(3);
  });

  it("inclusive pricing in the live calculation", async () => {
    const r = await c.call(calcApi.POST, { body: { placeOfSupply: "33", priceMode: "inclusive", lines: [{ description: "x", qty: 1, unitPrice: "1050", gstRateBp: 500 }] } });
    expect(r.data).toMatchObject({ taxableValue: 100000, grandTotal: 105000 });
  });

  it("GSTR-1 and GSTR-3B for a full month", async () => {
    await sale("DC/26-27/001");
    await sale("DC/26-27/002", { partyGstin: GSTIN_TN });
    await sale("DC/26-27/003", { placeOfSupply: "29", lines: [{ ...CATER, qty: "1000" }] });
    await sale("DC/26-27/004", { lines: [{ description: "Fresh fruit (exempt)", hsnSac: "0804", qty: "1", unitPrice: "500", gstRateBp: 0, supplyKind: "nil" }] });
    const cn = await c.call(salesApi.POST, { body: { docType: "credit_note", number: "CN/26-27/001", date: "2026-10-20", partyName: "Maria Weddings", partyGstin: GSTIN_TN, placeOfSupply: "33", originalNumber: "DC/26-27/002", lines: [{ ...CATER, qty: "10" }] } });
    expect(cn.data.sale.section).toBe("cdnr");
    const oil = await bill("SMP/1", "Oil Traders", GSTIN_TN, { hsnSac: "1512", qty: "10", unitPrice: "100", gstRateBp: 500 });
    expect(oil.data.purchase.itcTotal).toBe(5000);
    await bill("KA/9", "Plates Co", GSTIN_KA, { hsnSac: "4823", unitPrice: "1000", gstRateBp: 1800 }, { date: "2026-10-06" });
    await bill("VEG/1", "Market", "", { hsnSac: "0709", unitPrice: "3000", gstRateBp: 0, supplyKind: "nil" }, { date: "2026-10-07" });
    const car = await bill("CAR/1", "Car Co", GSTIN_TN, { hsnSac: "9987", unitPrice: "1000", gstRateBp: 1800 }, { date: "2026-10-08", category: "motor_vehicle" });
    expect(car.data.purchase.itcTotal).toBe(0);

    const p = JSON.parse(text((await c.call(returnFile.GET, { params: { key: "2026-10", file: "gstr1.json" } })).data));
    expect(p.fp).toBe("102026");
    expect(p.b2b[0].ctin).toBe(GSTIN_TN);
    expect(p.b2b[0].inv[0].itms[0].itm_det.camt).toBe(675);
    expect(p.b2cl[0].pos).toBe("29");
    expect(p.b2cs[0].txval).toBe(27000);
    expect(p.b2cs[0]).not.toHaveProperty("iamt");
    expect(p.cdnr[0].nt[0].ntty).toBe("C");
    expect(p.nil.inv.find((n: { sply_ty: string }) => n.sply_ty === "INTRAB2C").nil_amt).toBe(500);
    expect(p.hsn.hsn_b2c.map((x: { hsn_sc: string }) => x.hsn_sc)).toEqual(expect.arrayContaining(["996334", "0804"]));
    expect(p.hsn.hsn_b2b[0].txval).toBe(27000 - 1800);
    expect(p.doc_issue.doc_det[0].docs[0].totnum).toBe(4);

    const g = (await c.call(returnApi.GET, { params: { key: "2026-10" } })).data;
    expect(g.gstr3b.t31.a.txval).toBe((27000 * 2 + 180000 - 1800) * 100);
    expect(g.gstr3b.t31.a.iamt).toBe(900000);
    expect(g.gstr3b.t31.c.txval).toBe(50000);
    expect(g.gstr3b.t4.a5.cgst).toBe(2500 + 9000);
    expect(g.gstr3b.t4.b1.cgst).toBe(9000);
    expect(g.gstr3b.t4.c.igst).toBe(18000);
    const g3 = (await c.call(returnFile.GET, { params: { key: "2026-10", file: "gstr3b.json" } }));
    expect(JSON.parse(text(g3.data)).inward_sup.isup_details[0]).toMatchObject({ ty: "GST", intra: 3000 });
    expect(g.compare.every((r: { difference: number }) => r.difference === 0)).toBe(true);
    for (const ret of ["gstr1", "gstr3b"]) {
      for (const fmt of ["json", "xlsx", "pdf", "csv"]) {
        const r = await c.call(returnFile.GET, { params: { key: "2026-10", file: `${ret}.${fmt}` } });
        expect(r.status, `${ret}.${fmt}`).toBe(200);
        expect((r.data as ArrayBuffer).byteLength).toBeGreaterThan(50);
      }
    }
  });

  it("5% no-ITC scheme makes purchases ineligible by default, and a line can be overridden", async () => {
    await c.call(businessApi.PUT, { method: "PUT", body: { legalName: "Dev Caters", stateCode: "33", filingFrequency: "monthly", fyStartYear: 2026, noItcScheme: true } });
    const p = (await bill("S1", "Oil", GSTIN_TN, { hsnSac: "1512", unitPrice: "100", gstRateBp: 500 })).data.purchase;
    expect(p.itcTotal).toBe(0);
    const lines = (await c.call(purchasesApi.GET, { path: "/api/purchases?itc=ineligible" })).data.rows;
    expect(lines).toHaveLength(1);
    const full = await import("@/app/api/purchases/[id]/route").then((m) => c.call(m.GET, { params: { id: String(p.id) } }));
    expect(full.data.lines[0]).toMatchObject({ itcEligible: false, itcReason: expect.stringMatching(/without ITC/) });
    const r = await c.call(itcPurchase.PATCH, { method: "PATCH", params: { id: String(p.id) }, body: { lines: [{ id: full.data.lines[0].id, itcEligible: true }] } });
    expect(r.status).toBe(200);
    expect(r.data.purchase.itcTotal).toBe(500);
  });

  it("filing locks the period; amendment reports only the difference; unlock needs a reason", async () => {
    const s = await sale("DC/26-27/001", { partyGstin: GSTIN_TN });
    const arn1 = { ret: "gstr1", arn: "AA3310260123456", filedOn: "2026-11-10" };
    expect((await c.call(filed.POST, { params: { key: "2026-10" }, body: arn1 })).status).toBe(422);
    expect((await c.call(approve.POST, { params: { key: "2026-10" }, body: {} })).status).toBe(200);
    expect((await c.call(filed.POST, { params: { key: "2026-10" }, body: arn1 })).status).toBe(200);
    expect((await c.call(filed.POST, { params: { key: "2026-10" }, body: { ret: "gstr3b", arn: "AA3310260987654", filedOn: "2026-11-19" } })).status).toBe(200);
    expect((await c.call(returnApi.GET, { params: { key: "2026-10" } })).data.status.locked).toBe(true);
    const body = { number: s.number, date: "2026-10-15", partyName: "X", placeOfSupply: "33", lines: [CATER] };
    expect((await c.call(saleApi.PUT, { method: "PUT", params: { id: String(s.id) }, body })).status).toBe(409);
    expect((await c.call(salesApi.POST, { body: { ...body, number: "NEW1" } })).status).toBe(409);
    const am = await c.call(amendApi.POST, { params: { id: String(s.id) }, body: { ...body, partyGstin: GSTIN_TN, lines: [{ ...CATER, qty: "160" }], amendPeriod: "2026-11" } });
    expect(am.status, JSON.stringify(am.data)).toBe(201);
    const g1 = JSON.parse(text((await c.call(returnFile.GET, { params: { key: "2026-11", file: "gstr1.json" } })).data));
    expect(g1.b2ba[0].inv[0]).toMatchObject({ oinum: "DC/26-27/001", inum: "DC/26-27/001" });
    expect((await c.call(returnApi.GET, { params: { key: "2026-11" } })).data.gstr3b.t31.a.txval).toBe(180000);
    const oct = JSON.parse(text((await c.call(returnFile.GET, { params: { key: "2026-10", file: "gstr1.json" } })).data));
    expect(oct.b2b[0].inv[0].val).toBe(28350);
    expect((await c.call(unlock.POST, { params: { key: "2026-10" }, body: { reason: "" } })).status).toBe(422);
    expect((await c.call(unlock.POST, { params: { key: "2026-10" }, body: { reason: "CA asked to fix a typo" } })).status).toBe(200);
  });

  it("tax payment set-off in 3B", async () => {
    await sale("DC/26-27/001", { partyGstin: GSTIN_TN });
    await bill("KA/1", "Plates", GSTIN_KA, { hsnSac: "4823", unitPrice: "5000", gstRateBp: 1800 }, { date: "2026-10-06" });
    const p = (await c.call(returnApi.GET, { params: { key: "2026-10" } })).data.gstr3b.payment;
    expect([p.paidByItc.cgst.igst, p.paidByItc.sgst.igst, p.cash.sgst]).toEqual([67500, 22500, 45000]);
  });

  it("imports sales with a Taxable column, checks tax amounts, rates, dates and GSTINs", async () => {
    const csv = [
      "Inv No,Bill Date,Party Name,GSTIN,Item,SAC,Members,Taxable,Rate,CGST,SGST,IGST",
      `A/1,15-10-2026,Hotel Sangam,${GSTIN_TN},Lunch,996334,100,18000,5,450,450,0`,
      `A/1,15-10-2026,Hotel Sangam,${GSTIN_TN},Dinner,996334,50,9000,5,225,225,0`,
      "A/2,16-10-2026,Walk in,,Lunch,996334,10,1800,5,10,10,0",
      "A/3,32-10-2026,Walk in,,Lunch,996334,10,1800,5,45,45,0",
      "A/4,16-10-2026,Walk in,33AAAAA0000A1Z0,Lunch,996334,10,1800,7,0,0,0",
    ].join("\n");
    const form = () => {
      const f = new FormData();
      f.set("kind", "sales");
      f.set("file", new File([csv], "sales.csv"));
      return f;
    };
    const pv = (await c.call(preview.POST, { form: form() })).data;
    const col = (key: string) => pv.headers[pv.mapping[key]];
    expect([col("number"), col("customer_gstin"), col("taxable_value"), col("gst_rate"), col("qty")]).toEqual(["Inv No", "GSTIN", "Taxable", "Rate", "Members"]);
    expect([pv.validRows, pv.errorRows]).toEqual([2, 3]);
    const err = (row: number) => pv.rows.find((r: { row: number }) => r.row === row).errors.join(" ");
    expect(err(4)).toMatch(/Tax should be 45\.00 CGST/);
    expect(err(5)).toMatch(/not a date/);
    expect(err(6)).toMatch(/GSTIN/);
    expect(err(6)).toMatch(/rate 7%/);
    expect(text((await c.call(errorReport.POST, { form: form() })).data)).toContain("Tax should be");
    expect((await c.call(commit.POST, { form: form() })).status).toBe(201);
    const inv = (await c.call(salesApi.GET, { path: "/api/sales?q=A%2F1" })).data.rows[0];
    expect(inv).toMatchObject({ taxableValue: 2700000, section: "b2b", cgst: 67500 });
  });

  it("imports customers from Excel-style headers (Client / Tax ID / Mobile)", async () => {
    const f = new FormData();
    f.set("kind", "customers");
    f.set("mapping", JSON.stringify({ gstin: 1, phone: 2 }));
    f.set("file", new File([`Client,Tax ID,Mobile\nHotel Sangam,${GSTIN_TN},9894191881\nWalk in,,`], "c.csv"));
    expect((await c.call(commit.POST, { form: f })).status).toBe(201);
    const ps = (await c.call(partiesApi.GET, { path: "/api/parties?kind=customer" })).data.parties;
    expect(ps.find((x: { gstin: string }) => x.gstin === GSTIN_TN)).toMatchObject({ name: "Hotel Sangam", stateCode: "33", phone: "9894191881" });
  });

  it("GSTR-2B from a ZIP: matched, mismatch, missing both ways, ITC deferred", async () => {
    for (const [n, amt] of [["SMP/1182", "100"], ["SMP/1183", "200"], ["SMP/1190", "50"]] as const) {
      await bill(n, "Oil", GSTIN_TN, { hsnSac: "1512", unitPrice: amt, gstRateBp: 1800 });
    }
    const doc = { data: { rtnprd: "102026", docdata: { b2b: [{ ctin: GSTIN_TN, trdnm: "Oil", inv: [
      { inum: "SMP-1182", dt: "05-10-2026", val: 118, itcavl: "Y", rev: "N", items: [{ txval: 100, cgst: 9, sgst: 9 }] },
      { inum: "SMP/1183", dt: "05-10-2026", val: 300, itcavl: "Y", rev: "N", items: [{ txval: 250, cgst: 22.5, sgst: 22.5 }] },
      { inum: "SMP/2000", dt: "06-10-2026", val: 59, itcavl: "Y", rev: "N", items: [{ txval: 50, cgst: 4.5, sgst: 4.5 }] },
    ] }] } } };
    const f = new FormData();
    f.set("period", "2026-10");
    f.set("file", new File([zipSync({ "GSTR2B_102026.json": strToU8(JSON.stringify(doc)) }) as BlobPart], "2b.zip"));
    expect((await c.call(gstr2b.POST, { form: f })).status).toBe(201);
    const r = (await c.call(recon.GET, { params: { period: "2026-10" } })).data;
    expect(r.summary).toMatchObject({ matched: 1, mismatch: 1, missing_in_2b: 1, missing_in_books: 1, probable: 0 });
    const g = (await c.call(returnApi.GET, { params: { key: "2026-10" } })).data;
    // claimed: 1182 (9 + 9) and 1183 (18 + 18, flagged); deferred: 1190 (4.50 + 4.50)
    expect(g.gstr3b.t4.a5).toMatchObject({ cgst: 900 + 1800, sgst: 900 + 1800 });
    expect(g.issues.join(" ")).toMatch(/1 purchase bill\(s\) are not in GSTR-2B/);
  });

  it("refuses the same attachment twice on one record", async () => {
    const s = await sale("DC/26-27/001");
    const f = () => {
      const x = new FormData();
      x.set("entity_type", "sale");
      x.set("entity_id", String(s.id));
      x.set("file", new File([new Uint8Array([...Buffer.from("%PDF-1.4 test")]) as BlobPart], "bill.pdf", { type: "application/pdf" }));
      return x;
    };
    expect((await c.call(docs.POST, { form: f() })).status).toBe(201);
    expect((await c.call(docs.POST, { form: f() })).status).toBe(409);
  });
});

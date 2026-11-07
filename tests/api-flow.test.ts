import { beforeAll, describe, expect, it } from "vitest";
import * as setup from "@/app/api/auth/setup/route";
import * as businessApi from "@/app/api/business/route";
import * as partiesApi from "@/app/api/parties/route";
import * as calc from "@/app/api/gst/calculate/route";
import * as salesApi from "@/app/api/sales/route";
import * as saleApi from "@/app/api/sales/[id]/route";
import * as saleCancel from "@/app/api/sales/[id]/cancel/route";
import * as salePdf from "@/app/api/sales/[id]/pdf/route";
import * as nextNumber from "@/app/api/sales/next-number/route";
import * as purchasesApi from "@/app/api/purchases/route";
import * as purchaseApi from "@/app/api/purchases/[id]/route";
import * as itcPurchase from "@/app/api/itc/purchases/[id]/route";
import * as adjustments from "@/app/api/itc/adjustments/route";
import * as returnsList from "@/app/api/returns/route";
import * as returnApi from "@/app/api/returns/[key]/route";
import * as approve from "@/app/api/returns/[key]/approve/route";
import * as filed from "@/app/api/returns/[key]/filed/route";
import * as unlock from "@/app/api/returns/[key]/unlock/route";
import * as lock from "@/app/api/returns/[key]/lock/route";
import * as returnFile from "@/app/api/returns/[key]/[file]/route";
import * as reportApi from "@/app/api/reports/[kind]/route";
import * as reportExport from "@/app/api/reports/[kind]/export/route";
import * as salesExport from "@/app/api/sales/export/route";
import * as home from "@/app/api/home/route";
import * as backup from "@/app/api/backup/route";
import * as auditApi from "@/app/api/users/audit/route";
import { REPORTS } from "@/lib/reports";
import { Client, freshDb, gstin, OWNER } from "./helpers";

const BIZ_GSTIN = gstin("33", "AABCD1234E");
const CUST_GSTIN = gstin("33", "AAACX9999K");
const SUPP_GSTIN = gstin("33", "AAACS5555P");
const c = new Client();

const line = (o: Record<string, unknown> = {}) => ({ description: "Wedding lunch", hsnSac: "996334", qty: "100", unit: "OTH", unitPrice: "250", gstRateBp: 500, ...o });
const saleBody = (o: Record<string, unknown> = {}) => ({ date: "2026-10-15", partyName: "Kumar Weds", partyGstin: CUST_GSTIN, placeOfSupply: "33", lines: [line()], ...o });
const billBody = (o: Record<string, unknown> = {}) => ({
  number: "B-1", date: "2026-10-10", supplierName: "Anna Stores", supplierGstin: SUPP_GSTIN, supplierStateCode: "33",
  lines: [{ description: "Oil", hsnSac: "1507", qty: "10", unit: "LTR", unitPrice: "150", gstRateBp: 500 }], ...o,
});

describe("sales, purchases, returns", () => {
  let saleId = 0;
  let billId = 0;

  beforeAll(async () => {
    await freshDb();
    await c.call(setup.POST, { body: { ...OWNER, businessName: "Dev Caters", stateCode: "33" } });
    const r = await c.call(businessApi.PUT, { method: "PUT", body: {
      legalName: "Dev Caters", tradeName: "Dev Caters", gstin: BIZ_GSTIN, stateCode: "33", filingFrequency: "monthly", fyStartYear: 2026, address: "Trichy",
    } });
    expect(r.status).toBe(200);
  });

  it("validates business GSTIN against state", async () => {
    const r = await c.call(businessApi.PUT, { method: "PUT", body: { legalName: "X", gstin: BIZ_GSTIN, stateCode: "29", filingFrequency: "monthly", fyStartYear: 2026 } });
    expect(r.status).toBe(422);
  });

  it("creates parties and rejects a bad GSTIN", async () => {
    expect((await c.call(partiesApi.POST, { body: { kind: "customer", name: "Kumar Weds", gstin: CUST_GSTIN, stateCode: "33" } })).status).toBe(200);
    expect((await c.call(partiesApi.POST, { body: { kind: "customer", name: "Bad", gstin: "33AAAAA0000A1Z0", stateCode: "33" } })).status).toBe(422);
  });

  it("previews tax via /api/gst/calculate", async () => {
    const r = await c.call(calc.POST, { body: { placeOfSupply: "33", lines: [line()] } });
    expect(r.data).toMatchObject({ taxableValue: 2500000, cgst: 62500, sgst: 62500, grandTotal: 2625000 });
  });

  it("creates a B2B invoice with an auto number", async () => {
    expect((await c.call(nextNumber.GET)).data.number).toBe("INV-0001");
    const r = await c.call(salesApi.POST, { body: saleBody() });
    expect(r.status).toBe(201);
    expect(r.data.sale).toMatchObject({ number: "INV-0001", section: "b2b", grandTotal: 2625000, cgst: 62500 });
    saleId = r.data.sale.id;
    const dup = await c.call(salesApi.POST, { body: saleBody({ number: "INV-0001" }) });
    expect(dup.status).toBe(409);
  });

  it("server recomputes totals; client numbers are ignored", async () => {
    const r = await c.call(salesApi.POST, { body: { ...saleBody({ partyGstin: "", partyName: "Walk-in", placeOfSupply: "29" }), grandTotal: 1, cgst: 999 } });
    expect(r.data.sale).toMatchObject({ section: "b2cs", igst: 125000, cgst: 0, grandTotal: 2625000 });
  });

  it("credit note needs the original invoice", async () => {
    expect((await c.call(salesApi.POST, { body: saleBody({ docType: "credit_note" }) })).status).toBe(422);
    const r = await c.call(salesApi.POST, { body: saleBody({ docType: "credit_note", originalNumber: "INV-0001", lines: [line({ qty: "10" })] }) });
    expect(r.data.sale).toMatchObject({ number: "CN-0001", section: "cdnr", grandTotal: 262500 });
  });

  it("lists with totals (credit notes negative) and filters", async () => {
    const r = await c.call(salesApi.GET, { path: "/api/sales?period=2026-10" });
    expect(r.data.total).toBe(3);
    expect(r.data.totals.grandTotal).toBe(2625000 + 2625000 - 262500);
    const b2b = await c.call(salesApi.GET, { path: "/api/sales?period=2026-10&section=b2b" });
    expect(b2b.data.total).toBe(1);
  });

  it("prints a PDF invoice", async () => {
    const r = await c.call(salePdf.GET, { params: { id: String(saleId) } });
    expect(r.res.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(r.data as ArrayBuffer).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("purchase ITC: eligible, blocked 17(5), unregistered", async () => {
    const a = await c.call(purchasesApi.POST, { body: billBody() });
    expect(a.status).toBe(201);
    expect(a.data.purchase).toMatchObject({ itcPeriod: "2026-10", itcTotal: 7500, cgst: 3750 });
    billId = a.data.purchase.id;
    const b = await c.call(purchasesApi.POST, { body: billBody({ number: "B-2", category: "food_blocked" }) });
    expect(b.data.purchase.itcTotal).toBe(0);
    const u = await c.call(purchasesApi.POST, { body: billBody({ number: "B-3", supplierGstin: "", supplierName: "Market" }) });
    expect(u.data.purchase.itcTotal).toBe(0);
    expect((await c.call(purchasesApi.POST, { body: billBody() })).status).toBe(409);
  });

  it("defect 1: ITC filter runs in SQL so total is accurate with pagination", async () => {
    const r = await c.call(purchasesApi.GET, { path: "/api/purchases?itc=eligible&pageSize=1&page=1" });
    expect(r.data.total).toBe(1);
    expect(r.data.rows).toHaveLength(1);
    const inel = await c.call(purchasesApi.GET, { path: "/api/purchases?itc=ineligible&pageSize=1" });
    expect(inel.data.total).toBe(2);
    expect(inel.data.rows).toHaveLength(1);
  });

  it("ITC adjustment feeds 3B", async () => {
    const r = await c.call(adjustments.POST, { body: { period: "2026-10", kind: "reversal", rule: "rule_42", cgst: "10", sgst: "10" } });
    expect(r.status).toBe(201);
  });

  it("computes the return overview", async () => {
    const r = await c.call(returnApi.GET, { params: { key: "2026-10" } });
    expect(r.status).toBe(200);
    // Output: CGST/SGST 62500 B2B − 6250 credit note; IGST 125000 inter-state B2CS.
    expect(r.data.gstr3b.t31.a).toMatchObject({ iamt: 125000, camt: 56250, samt: 56250 });
    // ITC: 3750 CGST + 3750 SGST eligible + blocked bill 3750/3750 (shown and reversed); adj 1000/1000.
    expect(r.data.gstr3b.t4.a5).toMatchObject({ cgst: 7500, sgst: 7500 });
    expect(r.data.gstr3b.t4.b1).toMatchObject({ cgst: 4750, sgst: 4750 });
    expect(r.data.gstr3b.t4.c).toMatchObject({ cgst: 2750, sgst: 2750 });
    expect(r.data.compare.every((x: { difference: number }) => x.difference === 0)).toBe(true);
  });

  it("downloads GSTR-1 JSON/XLSX/CSV/PDF and GSTR-3B JSON", async () => {
    const j = await c.call(returnFile.GET, { params: { key: "2026-10", file: "gstr1.json" } });
    const p = JSON.parse(Buffer.from(j.data as ArrayBuffer).toString());
    expect(p.gstin).toBe(BIZ_GSTIN);
    expect(p.fp).toBe("102026");
    expect(p.b2b[0].inv[0].inum).toBe("INV-0001");
    const x = await c.call(returnFile.GET, { params: { key: "2026-10", file: "gstr1.xlsx" } });
    expect(Buffer.from(x.data as ArrayBuffer).subarray(0, 2).toString()).toBe("PK");
    const csv = await c.call(returnFile.GET, { params: { key: "2026-10", file: "gstr1.csv" } });
    expect(Buffer.from(csv.data as ArrayBuffer).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    const pdf = await c.call(returnFile.GET, { params: { key: "2026-10", file: "gstr3b.pdf" } });
    expect(Buffer.from(pdf.data as ArrayBuffer).subarray(0, 4).toString()).toBe("%PDF");
    const g3 = await c.call(returnFile.GET, { params: { key: "2026-10", file: "gstr3b.json" } });
    expect(Object.keys(JSON.parse(Buffer.from(g3.data as ArrayBuffer).toString()))).toEqual(["gstin", "ret_period", "sup_details", "inter_sup", "itc_elg", "inward_sup", "intr_ltfee"]);
    expect((await c.call(returnFile.GET, { params: { key: "2026-10", file: "gstr9.json" } })).status).toBe(404);
  });

  it("filing needs approval; filing both locks the period", async () => {
    const arn = { arn: "AA3310260000001", filedOn: "2026-11-10" };
    expect((await c.call(filed.POST, { params: { key: "2026-10" }, body: { ret: "gstr1", ...arn } })).status).toBe(422);
    expect((await c.call(approve.POST, { params: { key: "2026-10" }, body: { ret: "both" } })).status).toBe(200);
    expect((await c.call(filed.POST, { params: { key: "2026-10" }, body: { ret: "gstr1", ...arn } })).data.status.locked).toBe(false);
    const r = await c.call(filed.POST, { params: { key: "2026-10" }, body: { ret: "gstr3b", ...arn, arn: "AA3310260000002" } });
    expect(r.data.status).toMatchObject({ locked: true, gstr1Status: "filed", gstr3bStatus: "filed" });
  });

  it("locked period rejects edits to sales, purchases, cancels and adjustments", async () => {
    expect((await c.call(saleApi.PUT, { method: "PUT", params: { id: String(saleId) }, body: saleBody() })).status).toBe(409);
    expect((await c.call(salesApi.POST, { body: saleBody({ date: "2026-10-31" }) })).status).toBe(409);
    expect((await c.call(saleCancel.POST, { params: { id: String(saleId) }, body: { reason: "x" } })).status).toBe(409);
    expect((await c.call(purchaseApi.PUT, { method: "PUT", params: { id: String(billId) }, body: billBody() })).status).toBe(409);
    expect((await c.call(adjustments.POST, { body: { period: "2026-10", kind: "reclaim", rule: "rule_42", cgst: "1" } })).status).toBe(409);
  });

  it("defect 4: a November bill cannot move its ITC into locked October, nor out of it", async () => {
    const nov = await c.call(purchasesApi.POST, { body: billBody({ number: "B-9", date: "2026-11-02" }) });
    expect(nov.status).toBe(201);
    const id = String(nov.data.purchase.id);
    // ITC period earlier than the bill date is invalid anyway
    expect((await c.call(itcPurchase.PATCH, { method: "PATCH", params: { id }, body: { itcPeriod: "2026-10" } })).status).toBe(422);
    // October bill (locked) cannot have its ITC moved to November
    expect((await c.call(itcPurchase.PATCH, { method: "PATCH", params: { id: String(billId) }, body: { itcPeriod: "2026-11" } })).status).toBe(409);
    // A November bill can defer ITC to December, then not into a locked period
    expect((await c.call(itcPurchase.PATCH, { method: "PATCH", params: { id }, body: { itcPeriod: "2026-12" } })).status).toBe(200);
    expect((await c.call(lock.POST, { params: { key: "2026-12" } })).status).toBe(200);
    const lines = (await c.call(purchaseApi.GET, { params: { id } })).data.lines;
    expect((await c.call(itcPurchase.PATCH, { method: "PATCH", params: { id }, body: { lines: [{ id: lines[0].id, itcEligible: false }] } })).status).toBe(409);
    expect((await c.call(unlock.POST, { params: { key: "2026-12" }, body: { reason: "test unlock" } })).status).toBe(200);
  });

  it("defect 2: unlock restores a consistent editable state", async () => {
    expect((await c.call(unlock.POST, { params: { key: "2026-10" }, body: { reason: "no" } })).status).toBe(422);
    const r = await c.call(unlock.POST, { params: { key: "2026-10" }, body: { reason: "Customer GSTIN was wrong" } });
    expect(r.data.status).toMatchObject({ locked: false, gstr1Status: "approved", gstr3bStatus: "approved", gstr1Arn: "", gstr3bArn: "", gstr1FiledOn: null, snapshot: null });
    expect((await c.call(saleApi.PUT, { method: "PUT", params: { id: String(saleId) }, body: saleBody({ notes: "fixed" }) })).status).toBe(200);
    const audit = await c.call(auditApi.GET, { path: "/api/users/audit?entity_type=return" });
    const u = audit.data.audit.find((a: { action: string }) => a.action === "unlock");
    expect(u.summary).toContain("Customer GSTIN was wrong");
  });

  it("cancel marks the sale cancelled and excludes it from totals", async () => {
    const r = await c.call(saleCancel.POST, { params: { id: String(saleId) }, body: { reason: "Event called off" } });
    expect(r.data.sale.status).toBe("cancelled");
    const l = await c.call(salesApi.GET, { path: "/api/sales?period=2026-10" });
    expect(l.data.totals.grandTotal).toBe(2625000 - 262500);
  });

  it("every report builds and exports", async () => {
    for (const kind of Object.keys(REPORTS)) {
      const r = await c.call(reportApi.GET, { path: `/api/reports/${kind}?fy=2026`, params: { kind } });
      expect(r.status, kind).toBe(200);
      expect(r.data.table.columns.length, kind).toBeGreaterThan(0);
    }
    for (const fmt of ["pdf", "xlsx", "csv", "json"]) {
      const r = await c.call(reportExport.GET, { path: `/api/reports/sales-register/export?fmt=${fmt}&period=2026-10`, params: { kind: "sales-register" } });
      expect(r.status, fmt).toBe(200);
    }
    expect((await c.call(salesExport.GET, { path: "/api/sales/export?fmt=csv&period=2026-10" })).status).toBe(200);
    expect((await c.call(reportApi.GET, { path: "/api/reports/nope", params: { kind: "nope" } })).status).toBe(404);
  });

  it("home, returns list and backup work", async () => {
    expect((await c.call(home.GET)).status).toBe(200);
    const l = await c.call(returnsList.GET);
    expect(l.data.periods).toHaveLength(12);
    const b = await c.call(backup.GET);
    expect(b.res.headers.get("content-type")).toBe("application/zip");
    const text = Buffer.from(b.data as ArrayBuffer).toString("latin1");
    expect(text).not.toContain("passwordHash");
  });
});

import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import * as setup from "@/app/api/auth/setup/route";
import * as businessApi from "@/app/api/business/route";
import * as salesApi from "@/app/api/sales/route";
import * as saleApi from "@/app/api/sales/[id]/route";
import * as saleCancel from "@/app/api/sales/[id]/cancel/route";
import * as amendApi from "@/app/api/sales/[id]/amend/route";
import * as purchasesApi from "@/app/api/purchases/route";
import * as approve from "@/app/api/returns/[key]/approve/route";
import * as filed from "@/app/api/returns/[key]/filed/route";
import * as returnApi from "@/app/api/returns/[key]/route";
import * as returnFile from "@/app/api/returns/[key]/[file]/route";
import * as preview from "@/app/api/imports/preview/route";
import * as commit from "@/app/api/imports/commit/route";
import * as errorReport from "@/app/api/imports/error-report/route";
import * as batches from "@/app/api/imports/route";
import * as rollback from "@/app/api/imports/[id]/rollback/route";
import * as template from "@/app/api/imports/template/[file]/route";
import * as partiesApi from "@/app/api/parties/route";
import * as gstr2b from "@/app/api/itc/gstr2b/route";
import * as recon from "@/app/api/itc/recon/[period]/route";
import { Client, freshDb, gstin, OWNER } from "./helpers";

const BIZ = gstin("33", "AABCD1234E");
const CUST = gstin("33", "AAACX9999K");
const SUPP = gstin("33", "AAACS5555P");
const c = new Client();

function upload(kind: string, name: string, data: string | Uint8Array, mapping?: Record<string, number>, extra: Record<string, string> = {}) {
  const f = new FormData();
  f.set("kind", kind);
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  f.set("file", new File([data as BlobPart], name));
  if (mapping) f.set("mapping", JSON.stringify(mapping));
  return f;
}
const text = (d: unknown) => Buffer.from(d as ArrayBuffer).toString("utf8");

beforeAll(async () => {
  await freshDb();
  await c.call(setup.POST, { body: { ...OWNER, businessName: "Dev Caters", stateCode: "33" } });
  await c.call(businessApi.PUT, { method: "PUT", body: { legalName: "Dev Caters", gstin: BIZ, stateCode: "33", filingFrequency: "monthly", fyStartYear: 2026 } });
});

describe("bulk import", () => {
  const csv = [
    "Invoice No,Invoice Date,Customer,GSTIN,Item,HSN,Qty,Price,GST %",
    `INV-0100,02-11-2026,Kumar Weddings,${CUST},Lunch,996334,100,250,5`,
    `INV-0100,02-11-2026,Kumar Weddings,${CUST},Tea,996334,100,20,5`,
    "INV-0101,03-11-2026,Walk-in,,Snacks,996334,1,1000,5",
    "INV-0102,31-11-2026,Bad Date,,Snacks,996334,1,1000,5",
  ].join("\n");

  it("offers templates", async () => {
    const t = await c.call(template.GET, { params: { file: "sales.csv" } });
    expect(text(t.data)).toContain("number,date,customer_name");
    const x = await c.call(template.GET, { params: { file: "customers.xlsx" } });
    expect(Buffer.from(x.data as ArrayBuffer).subarray(0, 2).toString()).toBe("PK");
  });

  it("previews without writing", async () => {
    const r = await c.call(preview.POST, { form: upload("sales", "nov.csv", csv) });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ totalRows: 4, validRows: 3, errorRows: 1, documentCount: 2 });
    expect(r.data.rows[3].errors[0]).toMatch(/not a date/);
    expect((await c.call(salesApi.GET, { path: "/api/sales?period=2026-11" })).data.total).toBe(0);
    const rep = await c.call(errorReport.POST, { form: upload("sales", "nov.csv", csv) });
    expect(text(rep.data)).toContain("INV-0102");
  });

  it("commits valid documents, refuses duplicates, and undoes exactly the batch", async () => {
    const r = await c.call(commit.POST, { form: upload("sales", "nov.csv", csv) });
    expect(r.status).toBe(201);
    const list = await c.call(salesApi.GET, { path: "/api/sales?period=2026-11" });
    expect(list.data.total).toBe(2);
    // 25000+2000 = 27000 @5% = 28350; 1000 @5% = 1050
    expect(list.data.totals.grandTotal).toBe(2835000 + 105000);
    const again = await c.call(preview.POST, { form: upload("sales", "nov.csv", csv) });
    expect(again.data.validRows).toBe(0);
    expect(again.data.rows[0].errors[0]).toMatch(/already exists/);
    const h = await c.call(batches.GET);
    const id = String(h.data.batches[0].id);
    expect((await c.call(rollback.POST, { params: { id } })).status).toBe(200);
    expect((await c.call(salesApi.GET, { path: "/api/sales?period=2026-11" })).data.total).toBe(0);
    expect((await c.call(rollback.POST, { params: { id } })).status).toBe(409);
  });

  it("imports customers from Excel with a mapping override", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Parties");
    ws.addRow(["Party", "Tax ID", "City"]);
    ws.addRow(["Kumar Weddings", CUST, "Trichy"]);
    ws.addRow(["Hotel Ganga", "", "Madurai"]);
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer);
    const p = await c.call(preview.POST, { form: upload("customers", "p.xlsx", bytes, { gstin: 1, address: 2 }) });
    expect(p.data, JSON.stringify(p.data)).toMatchObject({ validRows: 2, errorRows: 0 });
    expect((await c.call(commit.POST, { form: upload("customers", "p.xlsx", bytes, { gstin: 1, address: 2 }) })).status).toBe(201);
    const list = await c.call(partiesApi.GET, { path: "/api/parties?kind=customer" });
    expect(list.data.parties.map((x: { name: string }) => x.name)).toEqual(["Hotel Ganga", "Kumar Weddings"]);
  });

  it("payments import restores previous values on undo", async () => {
    const r = await c.call(commit.POST, { form: upload("payments", "pay.csv", "period,cgst,sgst,challan_ref\n2026-09,597.50,597.50,CIN123") });
    expect(r.status).toBe(201);
    const ov = await c.call(returnApi.GET, { params: { key: "2026-09" } });
    expect(ov.data.status).toMatchObject({ paidCgst: 59750, challanRef: "CIN123" });
    await c.call(rollback.POST, { params: { id: String(r.data.batch.id) } });
    expect((await c.call(returnApi.GET, { params: { key: "2026-09" } })).data.status).toMatchObject({ paidCgst: 0, challanRef: "" });
  });
});

describe("GSTR-2B", () => {
  const bill = (number: string, rate: string) => ({ number, date: "2026-11-02", supplierName: "Anna Stores", supplierGstin: SUPP, supplierStateCode: "33", lines: [{ description: "Oil", qty: "10", unitPrice: rate, gstRateBp: 500 }] });

  it("matches bills and defers ITC on bills missing from 2B", async () => {
    await c.call(purchasesApi.POST, { body: bill("AS-001", "210") }); // 2100 + 52.50 + 52.50
    await c.call(purchasesApi.POST, { body: bill("AS-002", "100") }); // not in 2B: 25 + 25 deferred
    const before = await c.call(returnApi.GET, { params: { key: "2026-11" } });
    expect(before.data.gstr3b.t4.c).toMatchObject({ cgst: 7750, sgst: 7750 });
    const json = JSON.stringify({ data: { docdata: { b2b: [{ ctin: SUPP, trdnm: "Anna", inv: [
      { inum: "AS/1", dt: "02-11-2026", val: 2205, items: [{ txval: 2100, cgst: 52.5, sgst: 52.5 }] },
      { inum: "AS-9", dt: "04-11-2026", val: 105, items: [{ txval: 100, cgst: 2.5, sgst: 2.5 }] },
    ] }] } } });
    const imp = await c.call(gstr2b.POST, { form: upload("", "2b.json", json, undefined, { period: "2026-11" }) });
    expect(imp.status).toBe(201);
    expect(imp.data.summary).toMatchObject({ matched: 1, missing_in_2b: 1, missing_in_books: 1 });
    const rec = await c.call(recon.GET, { params: { period: "2026-11" } });
    expect(rec.data.rows.find((r: { status: string }) => r.status === "missing_in_2b").book.number).toBe("AS-002");
    const after = await c.call(returnApi.GET, { params: { key: "2026-11" } });
    expect(after.data.gstr3b.t4.c).toMatchObject({ cgst: 5250, sgst: 5250 });
    expect(after.data.issues.join(" ")).toMatch(/ITC is deferred/);
    expect((await c.call(gstr2b.POST, { form: upload("", "x.txt", "hi", undefined, { period: "2026-11" }) })).status).toBe(422);
  });
});

describe("amendments", () => {
  let orig = 0;
  const body = (rate: string) => ({ number: "INV-0500", date: "2026-10-05", partyName: "Kumar Weddings", partyGstin: CUST, placeOfSupply: "33", lines: [{ description: "Lunch", qty: "100", unitPrice: rate, gstRateBp: 500 }] });

  it("refuses to amend an unfiled period", async () => {
    const r = await c.call(salesApi.POST, { body: body("1000") });
    orig = r.data.sale.id;
    const a = await c.call(amendApi.POST, { params: { id: String(orig) }, body: { ...body("1200"), amendPeriod: "2026-11" } });
    expect(a.status).toBe(422);
    expect(a.data.error).toMatch(/not filed and locked/);
  });

  it("amends a filed invoice into a later period", async () => {
    await c.call(approve.POST, { params: { key: "2026-10" }, body: { ret: "both" } });
    await c.call(filed.POST, { params: { key: "2026-10" }, body: { ret: "gstr1", arn: "AA331026000001A", filedOn: "2026-11-10" } });
    await c.call(filed.POST, { params: { key: "2026-10" }, body: { ret: "gstr3b", arn: "AA331026000002B", filedOn: "2026-11-18" } });
    expect((await c.call(amendApi.POST, { params: { id: String(orig) }, body: { ...body("1200"), amendPeriod: "2026-10" } })).status).toBe(422);
    const a = await c.call(amendApi.POST, { params: { id: String(orig) }, body: { ...body("1200"), amendPeriod: "2026-11" } });
    expect(a.status).toBe(201);
    expect(a.data.sale).toMatchObject({ number: "INV-0500~A", amendsId: orig, amendPeriod: "2026-11", grandTotal: 12600000 });
    expect((await c.call(saleApi.PUT, { method: "PUT", params: { id: String(orig) }, body: body("1300") })).status).toBe(409);
    expect((await c.call(amendApi.POST, { params: { id: String(orig) }, body: { ...body("1300"), amendPeriod: "2026-11" } })).status).toBe(409);
  });

  it("November GSTR-1 shows b2ba; 3B adds only the difference; October is unchanged", async () => {
    const j = JSON.parse(text((await c.call(returnFile.GET, { params: { key: "2026-11", file: "gstr1.json" } })).data));
    expect(j.b2ba[0].inv[0]).toMatchObject({ oinum: "INV-0500", inum: "INV-0500", val: 126000 });
    const nov = await c.call(returnApi.GET, { params: { key: "2026-11" } });
    // difference 20000 taxable, 500 CGST, 500 SGST
    expect(nov.data.gstr3b.t31.a).toMatchObject({ txval: 2000000, camt: 50000, samt: 50000 });
    const oct = await c.call(returnApi.GET, { params: { key: "2026-10" } });
    expect(oct.data.gstr3b.t31.a).toMatchObject({ txval: 10000000, camt: 250000 });
    const list = await c.call(salesApi.GET, { path: "/api/sales?period=2026-10" });
    expect(list.data.totals.grandTotal).toBe(12600000); // only the current version counts
  });

  it("cancelling the amendment brings back the original", async () => {
    const list = await c.call(salesApi.GET, { path: "/api/sales?period=2026-10" });
    const am = list.data.rows.find((r: { number: string }) => r.number === "INV-0500~A");
    expect((await c.call(saleCancel.POST, { params: { id: String(am.id) }, body: { reason: "Entered by mistake" } })).status).toBe(200);
    const o = await c.call(saleApi.GET, { params: { id: String(orig) } });
    expect(o.data.doc.amendedById).toBeNull();
    const nov = await c.call(returnApi.GET, { params: { key: "2026-11" } });
    expect(nov.data.gstr3b.t31.a.txval).toBe(0);
  });
});

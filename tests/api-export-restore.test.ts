import { describe, expect, it } from "vitest";
import * as setup from "@/app/api/auth/setup/route";
import * as businessApi from "@/app/api/business/route";
import * as partiesApi from "@/app/api/parties/route";
import * as salesApi from "@/app/api/sales/route";
import * as purchasesApi from "@/app/api/purchases/route";
import * as payment from "@/app/api/returns/[key]/payment/route";
import * as returnFile from "@/app/api/returns/[key]/[file]/route";
import * as returnApi from "@/app/api/returns/[key]/route";
import * as exportsApi from "@/app/api/exports/[file]/route";
import * as preview from "@/app/api/imports/preview/route";
import * as commit from "@/app/api/imports/commit/route";
import * as rollback from "@/app/api/imports/[id]/rollback/route";
import * as backup from "@/app/api/backup/route";
import * as restore from "@/app/api/backup/restore/route";
import * as auditApi from "@/app/api/users/audit/route";
import { Client, freshDb, gstin, OWNER } from "./helpers";

const BIZ = gstin("33", "AABCD1234E");
const CUST = gstin("33", "AAACX9999K");
const SUPP = gstin("29", "AAACS5555P");
const IMPORT_ORDER = ["customers", "suppliers", "hsn", "sales", "notes", "purchases", "payments"] as const;
const buf = (d: unknown) => new Uint8Array(d as ArrayBuffer);
const text = (d: unknown) => Buffer.from(d as ArrayBuffer).toString("utf8");

async function newInstall(): Promise<Client> {
  await freshDb();
  const c = new Client();
  await c.call(setup.POST, { body: { ...OWNER, businessName: "Dev Caters", stateCode: "33" } });
  await c.call(businessApi.PUT, { method: "PUT", body: { legalName: "Dev Caters", gstin: BIZ, stateCode: "33", filingFrequency: "monthly", fyStartYear: 2026 } });
  return c;
}

/** Everything a return depends on, as numbers, for comparing installations. */
async function fingerprint(c: Client) {
  const g1 = JSON.parse(text((await c.call(returnFile.GET, { params: { key: "2026-11", file: "gstr1.json" } })).data));
  const g3 = JSON.parse(text((await c.call(returnFile.GET, { params: { key: "2026-11", file: "gstr3b.json" } })).data));
  const ov = await c.call(returnApi.GET, { params: { key: "2026-10" } });
  const sales = await c.call(salesApi.GET, { path: "/api/sales?fy=2026&pageSize=500" });
  return { g1, g3, paidOct: ov.data.status.paidCgst, salesTotals: sales.data.totals };
}

describe("export → import and backup → restore round trips", () => {
  let source: Awaited<ReturnType<typeof fingerprint>>;
  const exported: Record<string, Uint8Array> = {};
  let zip: Uint8Array;

  it("builds a source installation and exports it", async () => {
    const c = await newInstall();
    await c.call(partiesApi.POST, { body: { kind: "customer", name: "Kumar Weddings", gstin: CUST, stateCode: "33", phone: "98400 00000" } });
    await c.call(partiesApi.POST, { body: { kind: "supplier", name: "Bengaluru Foods", gstin: SUPP, stateCode: "29" } });
    const line = { description: "Lunch", hsnSac: "996334", qty: "120.5", unit: "PLT", unitPrice: "249.75", discount: "100", gstRateBp: 500 };
    await c.call(salesApi.POST, { body: { date: "2026-11-03", partyName: "Kumar Weddings", partyGstin: CUST, placeOfSupply: "33", lines: [line, { ...line, description: "Rice", hsnSac: "1006", gstRateBp: 0, supplyKind: "nil" }] } });
    await c.call(salesApi.POST, { body: { date: "2026-11-04", partyName: "Walk-in", placeOfSupply: "33", priceMode: "inclusive", lines: [{ description: "Snacks", qty: "1", unitPrice: "1050", gstRateBp: 500 }] } });
    await c.call(salesApi.POST, { body: { docType: "credit_note", date: "2026-11-09", partyName: "Kumar Weddings", partyGstin: CUST, placeOfSupply: "33", originalNumber: "INV-0001", noteReason: "Fewer plates", lines: [{ ...line, qty: "10" }] } });
    await c.call(purchasesApi.POST, { body: { number: "BF/77", date: "2026-11-02", supplierName: "Bengaluru Foods", supplierGstin: SUPP, supplierStateCode: "29", lines: [{ description: "Oil", hsnSac: "1507", qty: "20", unit: "LTR", unitPrice: "150", gstRateBp: 500 }, { description: "Snacks for staff", qty: "1", unitPrice: "500", gstRateBp: 1800, itcEligible: false, itcReason: "Personal" }] } });
    await c.call(payment.POST, { params: { key: "2026-10" }, body: { paidCgst: "597.50", paidSgst: "597.50", challanRef: "CIN-1", paidOn: "2026-11-18" } });
    source = await fingerprint(c);
    expect(source.g1.b2b[0].inv[0].inum).toBe("INV-0001");

    for (const kind of IMPORT_ORDER) {
      const r = await c.call(exportsApi.GET, { path: `/api/exports/${kind}.xlsx?fy=2026`, params: { file: `${kind}.xlsx` } });
      expect(r.status, kind).toBe(200);
      exported[kind] = buf(r.data);
    }
    const csv = await c.call(exportsApi.GET, { path: "/api/exports/sales.csv?period=2026-11", params: { file: "sales.csv" } });
    expect(text(csv.data)).toContain("INV-0001,2026-11-03,Kumar Weddings");
    zip = buf((await c.call(backup.GET)).data);
  });

  it("imports the exported files into a fresh installation with identical returns", async () => {
    const c = await newInstall();
    for (const kind of IMPORT_ORDER) {
      const form = () => {
        const f = new FormData();
        f.set("kind", kind);
        f.set("update", "1");
        f.set("file", new File([exported[kind] as BlobPart], `${kind}.xlsx`));
        return f;
      };
      const p = await c.call(preview.POST, { form: form() });
      expect(p.data.errorRows, `${kind}: ${JSON.stringify(p.data.rows.filter((r: { errors: string[] }) => r.errors.length))}`).toBe(0);
      expect((await c.call(commit.POST, { form: form() })).status, kind).toBe(201);
    }
    expect(await fingerprint(c)).toEqual(source);
  });

  it("restores the backup into a fresh installation with identical returns", async () => {
    const c = await newInstall();
    const f = new FormData();
    f.set("file", new File([zip as BlobPart], "gst-backup.zip"));
    const r = await c.call(restore.POST, { form: f });
    expect(r.status).toBe(200);
    expect(r.data.restored).toMatchObject({ sales_docs: 3, purchases: 1, parties: 2 });
    expect(await fingerprint(c)).toEqual(source);
    // New records still get fresh ids after the restore.
    const s = await c.call(salesApi.POST, { body: { date: "2026-11-20", partyName: "New", placeOfSupply: "33", lines: [{ description: "x", qty: "1", unitPrice: "10", gstRateBp: 500 }] } });
    expect(s.status).toBe(201);
    expect(s.data.sale.number).toBe("INV-0003");
    // A second restore is refused: the installation now has data.
    expect((await c.call(restore.POST, { form: f })).status).toBe(409);
    const log = await c.call(auditApi.GET, { path: "/api/users/audit" });
    expect(log.data.audit.some((a: { action: string }) => a.action === "restore")).toBe(true);
  });

  it("refuses a file that is not a backup", async () => {
    const c = await newInstall();
    const f = new FormData();
    f.set("file", new File([new Uint8Array([1, 2, 3]) as BlobPart], "x.zip"));
    expect((await c.call(restore.POST, { form: f })).status).toBe(422);
  });

  it("re-importing customers with 'update existing' changes them, and undo puts them back", async () => {
    const c = await newInstall();
    await c.call(partiesApi.POST, { body: { kind: "customer", name: "Kumar Weddings", gstin: "", stateCode: "33", phone: "111" } });
    const csv = `name,gstin,state,phone\nkumar weddings,${CUST},33,222\nHotel Ganga,,33,333`;
    const form = (update: boolean) => {
      const f = new FormData();
      f.set("kind", "customers");
      if (update) f.set("update", "1");
      f.set("file", new File([csv], "c.csv"));
      return f;
    };
    const plain = await c.call(preview.POST, { form: form(false) });
    expect(plain.data.rows[0].errors[0]).toMatch(/already exists/);
    const p = await c.call(preview.POST, { form: form(true) });
    expect(p.data).toMatchObject({ validRows: 2, updateCount: 1 });
    const done = await c.call(commit.POST, { form: form(true) });
    let list = (await c.call(partiesApi.GET, { path: "/api/parties?kind=customer" })).data.parties;
    expect(list.find((x: { name: string }) => x.name === "kumar weddings")).toMatchObject({ gstin: CUST, phone: "222" });
    await c.call(rollback.POST, { params: { id: String(done.data.batch.id) } });
    list = (await c.call(partiesApi.GET, { path: "/api/parties?kind=customer" })).data.parties;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Kumar Weddings", gstin: "", phone: "111" });
  });
});

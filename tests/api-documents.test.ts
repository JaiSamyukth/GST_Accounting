import { beforeAll, describe, expect, it } from "vitest";
import * as setup from "@/app/api/auth/setup/route";
import * as salesApi from "@/app/api/sales/route";
import * as docs from "@/app/api/documents/route";
import * as docApi from "@/app/api/documents/[id]/route";
import * as docFile from "@/app/api/documents/[id]/file/route";
import { memoryStorage, setStorage } from "@/lib/storage";
import { Client, freshDb, OWNER } from "./helpers";

const PDF = new Uint8Array([...Buffer.from("%PDF-1.4\n%test\n")]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function form(entityId: string, name: string, bytes: Uint8Array, type: string) {
  const f = new FormData();
  f.set("entity_type", "sale");
  f.set("entity_id", entityId);
  f.set("kind", "bill_photo");
  f.set("file", new File([bytes as BlobPart], name, { type }));
  return f;
}

describe("attachments", () => {
  const c = new Client();
  const store = memoryStorage();
  let saleId = "";

  beforeAll(async () => {
    await freshDb();
    setStorage(store);
    await c.call(setup.POST, { body: { ...OWNER, businessName: "Dev Caters" } });
    const s = await c.call(salesApi.POST, { body: { date: "2026-11-01", partyName: "A", placeOfSupply: "33", lines: [{ description: "x", qty: "1", unitPrice: "100", gstRateBp: 500 }] } });
    saleId = String(s.data.sale.id);
  });

  it("uploads, lists, downloads and deletes", async () => {
    const up = await c.call(docs.POST, { form: form(saleId, "bill.pdf", PDF, "application/pdf") });
    expect(up.status).toBe(201);
    expect(up.data.document.objectKey).toMatch(new RegExp(`^sale/${saleId}/[0-9a-f-]+\\.pdf$`));
    expect(store.objects.size).toBe(1);
    const list = await c.call(docs.GET, { path: `/api/documents?entity_type=sale&entity_id=${saleId}` });
    expect(list.data.documents).toHaveLength(1);
    const id = String(up.data.document.id);
    const file = await c.call(docFile.GET, { params: { id } });
    expect(Buffer.from(file.data as ArrayBuffer)).toEqual(Buffer.from(PDF));
    expect((await c.call(docApi.DELETE, { method: "DELETE", params: { id } })).status).toBe(200);
    expect(store.objects.size).toBe(0);
  });

  it("accepts JPEG, rejects wrong type, spoofed content and oversize", async () => {
    expect((await c.call(docs.POST, { form: form(saleId, "photo.jpg", JPEG, "image/jpeg") })).status).toBe(201);
    expect((await c.call(docs.POST, { form: form(saleId, "a.exe", PDF, "application/octet-stream") })).status).toBe(422);
    expect((await c.call(docs.POST, { form: form(saleId, "fake.pdf", JPEG, "application/pdf") })).status).toBe(422);
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(PDF);
    expect((await c.call(docs.POST, { form: form(saleId, "big.pdf", big, "application/pdf") })).status).toBe(413);
    expect((await c.call(docs.POST, { form: form("99999", "bill.pdf", PDF, "application/pdf") })).status).toBe(404);
  });

  it("reports a missing object as unavailable without deleting the row", async () => {
    const up = await c.call(docs.POST, { form: form(saleId, "bill.pdf", PDF, "application/pdf") });
    store.objects.clear();
    expect((await c.call(docFile.GET, { params: { id: String(up.data.document.id) } })).status).toBe(404);
    expect((await c.call(docApi.GET, { params: { id: String(up.data.document.id) } })).status).toBe(200);
  });
});

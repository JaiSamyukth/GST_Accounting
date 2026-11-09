import { describe, expect, it } from "vitest";
import { autoMap, parseDate, parsePercent, parseState, validateTable } from "@/lib/gst/importers";
import { normaliseNumber, reconcile } from "@/lib/gst/recon";
import { parse2bJson } from "@/lib/gst/gstr2b";

describe("import value parsing", () => {
  it("reads dates, percents and states", () => {
    expect(parseDate("05-11-2026")).toBe("2026-11-05");
    expect(parseDate("5/1/2027")).toBe("2027-01-05");
    expect(parseDate("2026-11-05")).toBe("2026-11-05");
    expect(() => parseDate("31-02-2026")).toThrow();
    expect(parsePercent("5%")).toBe(500);
    expect(parsePercent("0.25")).toBe(25);
    expect(parseState("Tamil Nadu")).toBe("33");
    expect(parseState("29-Karnataka")).toBe("29");
    expect(parseState("7")).toBe("07");
  });

  it("maps headers by alias", () => {
    const m = autoMap("sales", ["Invoice No", "Invoice Date", "Customer", "GSTIN", "Item", "Qty", "Price", "GST %"]);
    expect(m).toMatchObject({ number: 0, date: 1, customer_name: 2, customer_gstin: 3, description: 4, qty: 5, rate: 6, gst_rate: 7 });
  });
});

describe("validateTable", () => {
  const headers = ["number", "date", "customer_name", "description", "qty", "rate", "gst_rate"];
  const ctx = { businessState: "33" };

  it("groups rows into documents and reports bad rows", () => {
    const rows = [
      ["INV-9", "05-11-2026", "A", "Lunch", "100", "250", "5"],
      ["INV-9", "05-11-2026", "A", "Tea", "100", "20", "5"],
      ["INV-10", "06-11-2026", "B", "Dinner", "1", "abc", "5"],
      ["INV-11", "2026-02-30", "C", "Dinner", "1", "10", "5"],
    ];
    const v = validateTable("sales", { headers, rows }, autoMap("sales", headers), ctx);
    expect(v.records).toHaveLength(1);
    const r = v.records[0];
    expect(r.rows).toEqual([2, 3]);
    expect(r.record.type === "sale" && r.record.input.lines).toHaveLength(2);
    expect(v.errorRows).toEqual(new Set([4, 5]));
  });

  it("rejects rows of one invoice that disagree on the customer", () => {
    const rows = [["INV-1", "2026-11-05", "A", "x", "1", "1", "5"], ["INV-1", "2026-11-05", "B", "y", "1", "1", "5"]];
    const v = validateTable("sales", { headers, rows }, autoMap("sales", headers), ctx);
    expect(v.records).toHaveLength(0);
    expect(v.errors[0].message).toMatch(/disagree on customer name/);
  });

  it("requires mapped columns", () => {
    const v = validateTable("sales", { headers: ["number"], rows: [["1"]] }, autoMap("sales", ["number"]), ctx);
    expect(v.errors.some((e) => e.row === 1)).toBe(true);
  });
});

describe("GSTR-2B and reconciliation", () => {
  it("normalises invoice numbers", () => {
    expect(normaliseNumber("INV/0012")).toBe("INV12");
    expect(normaliseNumber("inv-12")).toBe("INV12");
    expect(normaliseNumber("0007")).toBe("7");
  });

  it("parses portal JSON in rupees into paise", () => {
    const rows = parse2bJson({ data: { rtnprd: "112026", docdata: {
      b2b: [{ ctin: "33AAACA5555P1ZG", trdnm: "Anna", inv: [{ inum: "AS/778", dt: "02-11-2026", val: 2205, rev: "N", itcavl: "Y", items: [{ txval: 2100, cgst: 52.5, sgst: 52.5, igst: 0, cess: 0 }] }] }],
      cdnr: [{ ctin: "33AAACA5555P1ZG", trdnm: "Anna", nt: [{ ntnum: "CN1", typ: "C", dt: "03-11-2026", val: 105, items: [{ txval: 100, cgst: 2.5, sgst: 2.5 }] }] }],
    } } });
    expect(rows[0]).toMatchObject({ number: "AS/778", date: "2026-11-02", taxableValue: 210000, cgst: 5250, sgst: 5250, itcAvailable: true });
    expect(rows[1]).toMatchObject({ docType: "credit_note", taxableValue: 10000 });
  });

  it("classifies matched, mismatch, probable and missing both ways", () => {
    const doc = (id: number, number: string, txval: number, date = "2026-11-02") => ({ id, supplierGstin: "33X", supplierName: "S", docType: "invoice", number, date, taxableValue: txval, igst: 0, cgst: txval / 20, sgst: txval / 20, cess: 0 });
    const books = [doc(1, "A-001", 100000), doc(2, "A-2", 100000), doc(3, "B-9", 50000), doc(4, "Z-1", 7000)];
    const twoB = [
      { ...doc(0, "A/1", 100050), itcAvailable: true },          // ₹0.50 more taxable, ₹0.025 more tax: within ₹1
      { ...doc(0, "A2", 120000), itcAvailable: true },           // amounts differ
      { ...doc(0, "B-09X", 50000, "2026-11-05"), itcAvailable: true }, // probable
      { ...doc(0, "Q-1", 9000), itcAvailable: true },            // not in books
    ];
    const r = reconcile(books, twoB);
    const byNo = (n: string) => r.find((x) => x.book?.number === n)!;
    expect(byNo("A-001").status).toBe("matched");
    expect(byNo("A-2").status).toBe("mismatch");
    expect(byNo("A-2").diff?.taxableValue).toBe(-20000);
    expect(byNo("B-9").status).toBe("probable");
    expect(byNo("Z-1").status).toBe("missing_in_2b");
    expect(r.find((x) => x.twoB?.number === "Q-1")?.status).toBe("missing_in_books");
  });
});

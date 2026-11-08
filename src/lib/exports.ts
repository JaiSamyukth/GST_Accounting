// Export data in exactly the import template columns, so a file can be edited and imported back.
import { and, asc, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm";
import type { Tx } from "../db/client";
import { hsnCodes, parties, purchaseLines, purchases, returnPeriods, salesDocs, salesLines } from "../db/schema";
import type { Table } from "./export/table";
import { KINDS, type ImportKind } from "./gst/importers";
import { formatScaled } from "./money";
import { periodRange } from "./gst/periods";
import { portalNumber } from "./gst/returns";

export interface Range { from: string; to: string }

const yn = (b: boolean) => (b ? "Y" : "N");
const rupees = (p: number) => formatScaled(p, 2);
const pct = (bp: number) => String(bp / 100);
const trim = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);

type Row = Record<string, string>;

function lineCells(l: typeof salesLines.$inferSelect | typeof purchaseLines.$inferSelect): Row {
  return {
    description: l.description, hsn_sac: l.hsnSac, qty: trim(l.qty), unit: l.unit, rate: trim(l.unitPrice),
    discount: l.discount ? rupees(l.discount) : "", gst_rate: pct(l.gstRateBp), cess_rate: l.cessRateBp ? pct(l.cessRateBp) : "",
    supply_kind: l.supplyKind,
  };
}

async function exportSales(db: Tx, notes: boolean, r: Range): Promise<Row[]> {
  // Current versions only (an amendment replaces what it amends); cancelled documents are left out.
  const docs = await db.select().from(salesDocs).where(and(
    gte(salesDocs.date, r.from), lte(salesDocs.date, r.to), eq(salesDocs.status, "active"), isNull(salesDocs.amendedById),
    notes ? ne(salesDocs.docType, "invoice") : eq(salesDocs.docType, "invoice"),
  )).orderBy(asc(salesDocs.date), asc(salesDocs.number));
  if (!docs.length) return [];
  const lines = await db.select().from(salesLines).where(inArray(salesLines.docId, docs.map((d) => d.id))).orderBy(asc(salesLines.position));
  return docs.flatMap((d) => lines.filter((l) => l.docId === d.id).map((l) => ({
    doc_type: d.docType, original_number: d.originalNumber, original_date: d.originalDate ?? "", reason: d.noteReason,
    number: portalNumber(d.number), date: d.date, customer_name: d.partyName, customer_gstin: d.partyGstin,
    place_of_supply: d.isExport ? "" : d.placeOfSupply, customer_address: d.partyAddress, price_mode: d.priceMode,
    reverse_charge: yn(d.reverseCharge), is_export: yn(d.isExport), export_with_igst: yn(d.exportWithIgst),
    order_ref: d.orderRef, notes: d.notes, ...lineCells(l),
  })));
}

async function exportPurchases(db: Tx, r: Range): Promise<Row[]> {
  const docs = await db.select().from(purchases).where(and(gte(purchases.date, r.from), lte(purchases.date, r.to), eq(purchases.status, "active")))
    .orderBy(asc(purchases.date), asc(purchases.number));
  if (!docs.length) return [];
  const lines = await db.select().from(purchaseLines).where(inArray(purchaseLines.docId, docs.map((d) => d.id))).orderBy(asc(purchaseLines.position));
  return docs.flatMap((d) => lines.filter((l) => l.docId === d.id).map((l) => ({
    doc_type: d.docType, number: d.number, date: d.date, supplier_name: d.supplierName, supplier_gstin: d.supplierGstin,
    supplier_state: d.supplierStateCode, category: d.category, itc_period: d.itcPeriod, price_mode: d.priceMode,
    reverse_charge: yn(d.reverseCharge), ...lineCells(l), itc_eligible: yn(l.itcEligible), itc_reason: l.itcReason,
    original_number: d.originalNumber, notes: d.notes,
  })));
}

/** Rows in the import template's columns. Sales, notes, purchases and payments use the date range. */
export async function exportRows(db: Tx, kind: ImportKind, r: Range): Promise<Row[]> {
  switch (kind) {
    case "sales": return exportSales(db, false, r);
    case "notes": return exportSales(db, true, r);
    case "purchases": return exportPurchases(db, r);
    case "customers":
    case "suppliers": {
      const rows = await db.select().from(parties).where(eq(parties.kind, kind === "customers" ? "customer" : "supplier")).orderBy(asc(parties.name));
      return rows.map((p) => ({ name: p.name, gstin: p.gstin, state: p.stateCode, address: p.address, phone: p.phone, email: p.email }));
    }
    case "hsn": {
      const rows = await db.select().from(hsnCodes).orderBy(asc(hsnCodes.code));
      return rows.map((h) => ({ code: h.code, description: h.description, gst_rate: pct(h.defaultRateBp), supply_kind: h.supplyKind, uqc: h.uqc, is_service: yn(h.isService) }));
    }
    case "payments": {
      const rows = await db.select().from(returnPeriods).orderBy(asc(returnPeriods.period));
      return rows
        .filter((p) => {
          // Periods inside the range that have a payment recorded.
          const any = p.paidIgst || p.paidCgst || p.paidSgst || p.paidCess || p.interest || p.lateFee || p.challanRef;
          const pr = periodRange(p.period);
          return !!any && pr.from >= r.from && pr.to <= r.to;
        })
        .map((p) => ({
          period: p.period, igst: rupees(p.paidIgst), cgst: rupees(p.paidCgst), sgst: rupees(p.paidSgst), cess: rupees(p.paidCess),
          interest: rupees(p.interest), late_fee: rupees(p.lateFee), challan_ref: p.challanRef, paid_on: p.paidOn ?? "",
        }));
    }
  }
}

export async function exportTable(db: Tx, kind: ImportKind, r: Range): Promise<Table> {
  const rows = await exportRows(db, kind, r);
  const keys = KINDS[kind].fields.map((f) => f.key);
  return { title: kind, columns: keys.map((k) => ({ key: k, label: k })), rows: rows.map((row) => Object.fromEntries(keys.map((k) => [k, row[k] ?? ""]))) };
}


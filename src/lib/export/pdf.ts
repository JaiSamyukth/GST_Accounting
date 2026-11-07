import PDFDocument from "pdfkit";
import { STATES } from "../gst/gstin";
import { amountInWords, formatINR, formatScaled } from "../money";
import type { Business } from "../settings";
import type { Cell, Column, Table } from "./table";

// Built-in Helvetica has no ₹ glyph, so amounts are printed as "Rs." or plain numbers.
const FOOTER = "Computer-generated document. Please check figures with your accountant before filing.";

function collect(doc: PDFKit.PDFDocument): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on("error", reject);
    doc.end();
  });
}

function cellText(c: Column, v: Cell): string {
  if (v === null || v === undefined) return "";
  if (c.type === "money" && typeof v === "number") return formatINR(v);
  if (c.type === "bp" && typeof v === "number") return `${v / 100}%`;
  return String(v);
}

function drawTable(doc: PDFKit.PDFDocument, t: Table): void {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const weights = t.columns.map((c) => (c.type === "money" ? 1.2 : c.type === "bp" || c.type === "number" ? 0.7 : 1.4));
  const sum = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / sum) * width);
  const fontSize = t.columns.length > 10 ? 6.5 : 8;

  const row = (cells: string[], bold: boolean) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
    const h = Math.max(...cells.map((s, i) => doc.heightOfString(s, { width: widths[i] - 4 }))) + 4;
    if (doc.y + h > doc.page.height - doc.page.margins.bottom - 20) doc.addPage();
    const y = doc.y;
    let x = left;
    cells.forEach((s, i) => {
      const c = t.columns[i];
      const align = c.type && c.type !== "text" ? "right" : "left";
      doc.text(s, x + 2, y + 2, { width: widths[i] - 4, align });
      x += widths[i];
    });
    doc.moveTo(left, y + h).lineTo(left + width, y + h).lineWidth(0.3).strokeColor("#999999").stroke();
    doc.x = left;
    doc.y = y + h;
  };

  doc.font("Helvetica-Bold").fontSize(11).fillColor("black").text(t.title, left, doc.y);
  doc.moveDown(0.3);
  row(t.columns.map((c) => c.label), true);
  for (const r of t.rows) row(t.columns.map((c) => cellText(c, r[c.key] ?? null)), false);
  if (t.totals) row(t.columns.map((c) => cellText(c, t.totals![c.key] ?? null)), true);
  if (!t.rows.length) doc.font("Helvetica").fontSize(8).text("No rows.", left);
  doc.moveDown(1);
}

export async function tablesPdf(title: string, subtitle: string, tables: Table[], landscape = true): Promise<Uint8Array> {
  const doc = new PDFDocument({ size: "A4", layout: landscape ? "landscape" : "portrait", margin: 36, info: { Title: title } });
  doc.font("Helvetica-Bold").fontSize(14).text(title);
  doc.font("Helvetica").fontSize(9).text(subtitle);
  doc.moveDown(0.8);
  for (const t of tables) drawTable(doc, t);
  doc.font("Helvetica-Oblique").fontSize(7).fillColor("#555555").text(FOOTER);
  return collect(doc);
}

export interface InvoicePdfData {
  title: string;
  number: string;
  date: string;
  partyName: string;
  partyGstin: string;
  partyAddress: string;
  placeOfSupply: string;
  reverseCharge: boolean;
  originalNumber?: string;
  originalDate?: string | null;
  noteReason?: string;
  cancelled: boolean;
  lines: Array<{
    description: string; hsnSac: string; qty: string; unit: string; unitPrice: string; discount: number;
    gstRateBp: number; taxableValue: number; cgst: number; sgst: number; igst: number; cess: number; total: number;
  }>;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  roundOff: number;
  grandTotal: number;
  notes: string;
}

function trimQty(q: string): string {
  return q.includes(".") ? q.replace(/0+$/, "").replace(/\.$/, "") : q;
}

export async function invoicePdf(biz: Business, d: InvoicePdfData): Promise<Uint8Array> {
  const doc = new PDFDocument({ size: "A4", margin: 40, info: { Title: `${d.title} ${d.number}` } });
  const left = 40;
  const width = doc.page.width - 80;

  doc.font("Helvetica-Bold").fontSize(15).text(biz.tradeName || biz.legalName || "Business name not set", left, 40);
  doc.font("Helvetica").fontSize(9);
  if (biz.tradeName && biz.legalName && biz.tradeName !== biz.legalName) doc.text(biz.legalName);
  if (biz.address) doc.text(biz.address);
  doc.text(`GSTIN: ${biz.gstin || "-"}    State: ${STATES[biz.stateCode] ?? biz.stateCode} (${biz.stateCode})`);
  if (biz.phone || biz.email) doc.text([biz.phone, biz.email].filter(Boolean).join("    "));
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(13).text(d.title + (d.cancelled ? " (CANCELLED)" : ""), { align: "center" });
  doc.moveDown(0.4);

  const top = doc.y;
  doc.font("Helvetica").fontSize(9);
  doc.text(`No: ${d.number}`, left, top);
  doc.text(`Date: ${d.date}`);
  doc.text(`Place of supply: ${STATES[d.placeOfSupply] ?? d.placeOfSupply} (${d.placeOfSupply})`);
  doc.text(`Reverse charge: ${d.reverseCharge ? "Yes" : "No"}`);
  if (d.originalNumber) doc.text(`Against invoice: ${d.originalNumber}${d.originalDate ? ` dated ${d.originalDate}` : ""}`);
  if (d.noteReason) doc.text(`Reason: ${d.noteReason}`);
  const leftBottom = doc.y;
  doc.font("Helvetica-Bold").text("Bill to", left + width / 2, top);
  doc.font("Helvetica").text(d.partyName, left + width / 2, doc.y, { width: width / 2 });
  if (d.partyAddress) doc.text(d.partyAddress, { width: width / 2 });
  doc.text(`GSTIN: ${d.partyGstin || "Unregistered"}`, { width: width / 2 });
  doc.x = left;
  doc.y = Math.max(leftBottom, doc.y) + 10;

  const intra = d.igst === 0 && (d.cgst > 0 || d.sgst > 0);
  const columns: Column[] = [
    { key: "n", label: "#", type: "number" },
    { key: "description", label: "Description" },
    { key: "hsnSac", label: "HSN/SAC" },
    { key: "qty", label: "Qty", type: "number" },
    { key: "unitPrice", label: "Rate", type: "number" },
    { key: "discount", label: "Disc.", type: "money" },
    { key: "taxableValue", label: "Taxable", type: "money" },
    { key: "gstRateBp", label: "GST", type: "bp" },
    ...(intra
      ? [{ key: "cgst", label: "CGST", type: "money" as const }, { key: "sgst", label: "SGST", type: "money" as const }]
      : [{ key: "igst", label: "IGST", type: "money" as const }]),
    ...(d.cess ? [{ key: "cess", label: "Cess", type: "money" as const }] : []),
    { key: "total", label: "Amount", type: "money" },
  ];
  drawTable(doc, {
    title: "",
    columns,
    rows: d.lines.map((l, i) => ({
      ...l, n: i + 1, qty: `${trimQty(l.qty)} ${l.unit}`, unitPrice: formatScaled(Math.round(Number(l.unitPrice) * 100), 2),
    })),
  });

  const sumRow = (label: string, v: number, bold = false) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5);
    const y = doc.y;
    doc.text(label, left + width * 0.55, y, { width: width * 0.25 });
    doc.text(formatINR(v), left + width * 0.8, y, { width: width * 0.2, align: "right" });
  };
  sumRow("Taxable value", d.taxableValue);
  if (d.cgst) sumRow("CGST", d.cgst);
  if (d.sgst) sumRow("SGST", d.sgst);
  if (d.igst) sumRow("IGST", d.igst);
  if (d.cess) sumRow("Cess", d.cess);
  if (d.roundOff) sumRow("Round off", d.roundOff);
  sumRow("Total (Rs.)", d.grandTotal, true);
  doc.x = left;
  doc.moveDown(0.6);
  doc.font("Helvetica").fontSize(9).text(amountInWords(d.grandTotal), left, doc.y, { width });
  if (d.notes) {
    doc.moveDown(0.5);
    doc.text(`Notes: ${d.notes}`, { width });
  }
  doc.moveDown(3);
  doc.text(`For ${biz.tradeName || biz.legalName}`, left, doc.y, { width, align: "right" });
  doc.moveDown(2);
  doc.text("Authorised signatory", { width, align: "right" });
  doc.moveDown(2);
  doc.font("Helvetica-Oblique").fontSize(7).fillColor("#555555").text(FOOTER, left, doc.y, { width });
  return collect(doc);
}

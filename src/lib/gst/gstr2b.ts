// Parse a GSTR-2B download (portal JSON, or a ZIP containing it) or a simple CSV/XLSX into rows.
import { unzipSync, strFromU8 } from "fflate";
import { paise } from "../money";
import { autoMapFields, parseBool, parseDate, type FieldDef } from "./importers";
import { readTable } from "./tabular";

export interface TwoBRow {
  supplierGstin: string;
  supplierName: string;
  docType: "invoice" | "credit_note" | "debit_note";
  number: string;
  date: string;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  itcAvailable: boolean;
  reverseCharge: boolean;
}

export class TwoBError extends Error {}

type J = Record<string, unknown>;
const arr = (v: unknown): J[] => (Array.isArray(v) ? (v as J[]) : []);
const num = (v: unknown): number => (typeof v === "number" || typeof v === "string" ? paise(String(v || 0)) : 0);
const str = (v: unknown): string => (v == null ? "" : String(v));

function sums(doc: J) {
  const items = arr(doc.items ?? doc.itms);
  if (!items.length) {
    return { taxableValue: num(doc.txval), igst: num(doc.igst ?? doc.iamt), cgst: num(doc.cgst ?? doc.camt), sgst: num(doc.sgst ?? doc.samt), cess: num(doc.cess ?? doc.csamt) };
  }
  const t = { taxableValue: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
  for (const raw of items) {
    const i = (raw.itm_det as J) ?? raw;
    t.taxableValue += num(i.txval);
    t.igst += num(i.igst ?? i.iamt);
    t.cgst += num(i.cgst ?? i.camt);
    t.sgst += num(i.sgst ?? i.samt);
    t.cess += num(i.cess ?? i.csamt);
  }
  return t;
}

export function parse2bJson(obj: unknown): TwoBRow[] {
  const root = (obj ?? {}) as J;
  const data = ((root.data as J) ?? root) as J;
  const docdata = ((data.docdata as J) ?? data) as J;
  const out: TwoBRow[] = [];
  for (const s of arr(docdata.b2b)) {
    for (const inv of arr(s.inv)) {
      out.push({
        supplierGstin: str(s.ctin).toUpperCase(), supplierName: str(s.trdnm), docType: "invoice", number: str(inv.inum),
        date: parseDate(str(inv.dt ?? inv.idt)) ?? "", ...sums(inv),
        itcAvailable: str(inv.itcavl || "Y").toUpperCase() !== "N", reverseCharge: str(inv.rev || inv.rchrg || "N").toUpperCase() === "Y",
      });
    }
  }
  for (const s of arr(docdata.cdnr)) {
    for (const nt of arr(s.nt)) {
      const t = str(nt.typ ?? nt.ntty).toUpperCase();
      out.push({
        supplierGstin: str(s.ctin).toUpperCase(), supplierName: str(s.trdnm), docType: t === "D" ? "debit_note" : "credit_note",
        number: str(nt.ntnum ?? nt.nt_num), date: parseDate(str(nt.dt ?? nt.nt_dt)) ?? "", ...sums(nt),
        itcAvailable: str(nt.itcavl || "Y").toUpperCase() !== "N", reverseCharge: str(nt.rev || "N").toUpperCase() === "Y",
      });
    }
  }
  return out;
}

const CSV_FIELDS: FieldDef[] = [
  { key: "supplier_gstin", label: "Supplier GSTIN", required: true, aliases: ["gstin", "ctin", "gstinofsupplier"], example: "" },
  { key: "supplier_name", label: "Supplier name", aliases: ["tradename", "trdnm", "name"], example: "" },
  { key: "doc_type", label: "Type", aliases: ["type", "doctype"], example: "invoice" },
  { key: "number", label: "Number", required: true, aliases: ["invoicenumber", "invoiceno", "inum", "notenumber"], example: "" },
  { key: "date", label: "Date", required: true, aliases: ["invoicedate", "dt"], example: "" },
  { key: "taxable_value", label: "Taxable value", required: true, aliases: ["taxablevalue", "txval"], example: "" },
  { key: "igst", label: "IGST", aliases: ["integratedtax"], example: "" },
  { key: "cgst", label: "CGST", aliases: ["centraltax"], example: "" },
  { key: "sgst", label: "SGST", aliases: ["statetax", "statetaxut"], example: "" },
  { key: "cess", label: "Cess", example: "" },
  { key: "itc_available", label: "ITC available (Y/N)", aliases: ["itcavailability", "itcavl"], example: "Y" },
  { key: "reverse_charge", label: "Reverse charge (Y/N)", aliases: ["rev", "reversecharge"], example: "N" },
];
export const TWO_B_CSV_HEADERS = CSV_FIELDS.map((f) => f.key);

export async function parse2bFile(bytes: Uint8Array, filename: string): Promise<TwoBRow[]> {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  try {
    if (ext === "json") return parse2bJson(JSON.parse(new TextDecoder().decode(bytes)));
    if (ext === "zip") {
      const files = unzipSync(bytes);
      const name = Object.keys(files).find((n) => n.toLowerCase().endsWith(".json"));
      if (!name) throw new TwoBError("The ZIP has no JSON file in it");
      return parse2bJson(JSON.parse(strFromU8(files[name])));
    }
    if (ext === "csv" || ext === "xlsx") {
      const t = await readTable(bytes, filename);
      const m = autoMapFields(CSV_FIELDS, t.headers);
      for (const f of CSV_FIELDS) if (f.required && m[f.key] < 0) throw new TwoBError(`Column "${f.key}" is missing`);
      const g = (cells: string[], k: string) => (m[k] >= 0 ? (cells[m[k]] ?? "").trim() : "");
      return t.rows.map((c, i) => {
        try {
          const dt = g(c, "doc_type").toLowerCase();
          return {
            supplierGstin: g(c, "supplier_gstin").toUpperCase(), supplierName: g(c, "supplier_name"),
            docType: dt.startsWith("c") ? "credit_note" : dt.startsWith("d") ? "debit_note" : "invoice",
            number: g(c, "number"), date: parseDate(g(c, "date")) ?? "",
            taxableValue: paise(g(c, "taxable_value") || "0"), igst: paise(g(c, "igst") || "0"), cgst: paise(g(c, "cgst") || "0"),
            sgst: paise(g(c, "sgst") || "0"), cess: paise(g(c, "cess") || "0"),
            itcAvailable: parseBool(g(c, "itc_available"), true), reverseCharge: parseBool(g(c, "reverse_charge")),
          } satisfies TwoBRow;
        } catch (e) {
          throw new TwoBError(`Row ${i + 2}: ${(e as Error).message}`);
        }
      });
    }
  } catch (e) {
    if (e instanceof TwoBError) throw e;
    throw new TwoBError(`Could not read the file: ${(e as Error).message}`);
  }
  throw new TwoBError("Upload the GSTR-2B JSON or ZIP from the portal, or a CSV/XLSX");
}

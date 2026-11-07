// Zod schemas and conversions for sales and purchase documents (the API boundary).
import { z } from "zod";
import { SUPPLY_KINDS, type LineInput } from "./gst/gst";
import { checkGstin, isStateCode } from "./gst/gstin";
import { isIsoDate, isPeriodKey } from "./gst/periods";
import { paise, parseScaled } from "./money";

const decimal = (label: string, scale: number) =>
  z.union([z.string(), z.number()]).transform((v, ctx) => {
    try {
      return parseScaled(v, scale);
    } catch {
      ctx.addIssue({ code: "custom", message: `${label} is not a valid number` });
      return z.NEVER;
    }
  });

const rupees = (label: string) =>
  z.union([z.string(), z.number()]).transform((v, ctx) => {
    if (v === "") return 0;
    try {
      return paise(v);
    } catch {
      ctx.addIssue({ code: "custom", message: `${label} is not a valid amount` });
      return z.NEVER;
    }
  });

export const isoDate = z.string().refine(isIsoDate, "Date must be YYYY-MM-DD");
export const periodKey = z.string().refine(isPeriodKey, "Period must be YYYY-MM or YYYY-Qn");
export const stateCode = z.string().refine(isStateCode, "Unknown state code");
export const optionalGstin = z
  .string()
  .default("")
  .transform((v) => v.replace(/\s+/g, "").toUpperCase())
  .refine((v) => v === "" || checkGstin(v).valid, "GSTIN is not valid");

export const docNumber = z
  .string()
  .trim()
  .min(1, "Number is required")
  .max(16, "Number can be at most 16 characters")
  .regex(/^[A-Za-z0-9/\-]+$/, "Number may contain only letters, digits, / and -");

export const lineSchema = z.object({
  description: z.string().trim().min(1, "Description is required").max(200),
  hsnSac: z.string().trim().max(8).regex(/^(\d{4,8})?$/, "HSN/SAC must be 4 to 8 digits").default(""),
  qty: decimal("Quantity", 3),
  unit: z.string().trim().max(10).default("NOS"),
  unitPrice: decimal("Rate", 4),
  discount: rupees("Discount").default(0),
  gstRateBp: z.number().int().min(0).max(10000),
  cessRateBp: z.number().int().min(0).max(10000).default(0),
  supplyKind: z.enum(SUPPLY_KINDS).default("taxable"),
});

export const purchaseLineSchema = lineSchema.extend({
  itcEligible: z.boolean().default(true),
  itcReason: z.string().max(200).default(""),
});

export const docTypes = ["invoice", "credit_note", "debit_note"] as const;

export const saleSchema = z
  .object({
    docType: z.enum(docTypes).default("invoice"),
    number: docNumber.optional(),
    date: isoDate,
    partyId: z.number().int().positive().nullable().default(null),
    partyName: z.string().trim().min(1, "Customer name is required").max(200),
    partyGstin: optionalGstin,
    partyAddress: z.string().max(500).default(""),
    placeOfSupply: stateCode,
    reverseCharge: z.boolean().default(false),
    priceMode: z.enum(["exclusive", "inclusive"]).default("exclusive"),
    notes: z.string().max(1000).default(""),
    originalNumber: z.string().trim().max(16).default(""),
    originalDate: isoDate.nullable().default(null),
    noteReason: z.string().max(200).default(""),
    isExport: z.boolean().default(false),
    exportWithIgst: z.boolean().default(false),
    orderRef: z.string().max(100).default(""),
    lines: z.array(lineSchema).min(1, "Add at least one line").max(500),
  })
  .superRefine((v, ctx) => {
    if (v.docType !== "invoice" && !v.originalNumber) {
      ctx.addIssue({ code: "custom", path: ["originalNumber"], message: "A note needs the original invoice number" });
    }
    if (v.isExport && v.partyGstin) {
      ctx.addIssue({ code: "custom", path: ["partyGstin"], message: "An export customer has no GSTIN" });
    }
  });
export type SaleInput = z.output<typeof saleSchema>;

export const PURCHASE_CATEGORIES = {
  goods: { label: "Goods / raw material", blocked: false },
  services: { label: "Services", blocked: false },
  capital_goods: { label: "Capital goods", blocked: false },
  food_blocked: { label: "Food & beverages for staff/guests (17(5))", blocked: true },
  motor_vehicle: { label: "Motor vehicles (17(5))", blocked: true },
  personal: { label: "Personal use (17(5))", blocked: true },
  other: { label: "Other", blocked: false },
} as const;
export type PurchaseCategory = keyof typeof PURCHASE_CATEGORIES;

export const purchaseSchema = z
  .object({
    docType: z.enum(docTypes).default("invoice"),
    number: docNumber,
    date: isoDate,
    supplierId: z.number().int().positive().nullable().default(null),
    supplierName: z.string().trim().min(1, "Supplier name is required").max(200),
    supplierGstin: optionalGstin,
    supplierStateCode: stateCode,
    placeOfSupply: stateCode.optional(),
    reverseCharge: z.boolean().default(false),
    priceMode: z.enum(["exclusive", "inclusive"]).default("exclusive"),
    category: z.enum(Object.keys(PURCHASE_CATEGORIES) as [PurchaseCategory, ...PurchaseCategory[]]).default("goods"),
    itcPeriod: periodKey.optional(),
    notes: z.string().max(1000).default(""),
    originalNumber: z.string().trim().max(16).default(""),
    lines: z.array(purchaseLineSchema).min(1, "Add at least one line").max(500),
  });
export type PurchaseInput = z.output<typeof purchaseSchema>;

export function toEngineLine(l: z.output<typeof lineSchema>): LineInput {
  return {
    description: l.description,
    hsnSac: l.hsnSac,
    qtyMilli: l.qty,
    unit: l.unit,
    unitPriceE4: l.unitPrice,
    discount: l.discount,
    gstRateBp: l.gstRateBp,
    cessRateBp: l.cessRateBp,
    supplyKind: l.supplyKind,
  };
}

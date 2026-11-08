import { z } from "zod";
import { optionalGstin, stateCode } from "./docs-input";
import { SUPPLY_KINDS } from "./gst/gst";

export const UQC = ["NOS", "KGS", "GMS", "LTR", "MLT", "PCS", "BOX", "PAC", "PLT", "SET", "OTH"];

export const rateSchema = z.object({
  rateBp: z.number().int().min(0).max(10000),
  label: z.string().trim().min(1).max(30),
  active: z.boolean().default(true),
});

export const hsnSchema = z.object({
  code: z.string().trim().regex(/^\d{4,8}$/, "HSN/SAC must be 4 to 8 digits"),
  description: z.string().trim().min(1).max(200),
  isService: z.boolean().default(false),
  defaultRateBp: z.number().int().min(0).max(10000),
  supplyKind: z.enum(SUPPLY_KINDS).default("taxable"),
  uqc: z.string().trim().toUpperCase().max(10).default("NOS"),
  itcAllowed: z.boolean().default(true),
  notes: z.string().max(500).default(""),
  active: z.boolean().default(true),
});

export const partySchema = z.object({
  kind: z.enum(["customer", "supplier"]),
  name: z.string().trim().min(1, "Name is required").max(200),
  gstin: optionalGstin,
  address: z.string().max(500).default(""),
  stateCode,
  phone: z.string().max(50).default(""),
  email: z.string().max(200).default(""),
  active: z.boolean().default(true),
}).superRefine((v, ctx) => {
  if (v.gstin && v.gstin.slice(0, 2) !== v.stateCode) {
    ctx.addIssue({ code: "custom", path: ["stateCode"], message: "State does not match the GSTIN" });
  }
});

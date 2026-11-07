import { z } from "zod";
import { periodKey } from "./docs-input";
import { rupeesField } from "./fields";

export const ITC_RULES = [
  { key: "rule_38", label: "Rule 38 (banking companies)" },
  { key: "rule_42", label: "Rule 42 (inputs used for exempt supplies)" },
  { key: "rule_43", label: "Rule 43 (capital goods used for exempt supplies)" },
  { key: "sec_17_5", label: "Section 17(5) (blocked credit)" },
  { key: "other", label: "Other reversals (4B(2))" },
] as const;

export const adjustmentSchema = z.object({
  period: periodKey,
  kind: z.enum(["reversal", "reclaim"]),
  rule: z.enum(ITC_RULES.map((r) => r.key) as [string, ...string[]]),
  igst: rupeesField("IGST"),
  cgst: rupeesField("CGST"),
  sgst: rupeesField("SGST"),
  cess: rupeesField("Cess"),
  note: z.string().max(500).default(""),
}).refine((v) => v.igst + v.cgst + v.sgst + v.cess > 0, "Enter an amount")
  .refine((v) => v.igst >= 0 && v.cgst >= 0 && v.sgst >= 0 && v.cess >= 0, "Amounts cannot be negative");

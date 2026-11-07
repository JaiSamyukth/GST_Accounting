import { z } from "zod";
import { paise } from "./money";

/** A rupee amount in a form ("1,234.50", 12, "") parsed to paise. */
export const rupeesField = (label: string) =>
  z.union([z.string(), z.number()]).default("0").transform((v, ctx) => {
    if (v === "") return 0;
    try {
      return paise(v);
    } catch {
      ctx.addIssue({ code: "custom", message: `${label} is not a valid amount` });
      return z.NEVER;
    }
  });

import type { Db } from "./client";
import { hsnCodes, taxRates } from "./schema";
import { getBusiness } from "../lib/settings";

export const DEFAULT_RATES = [
  { rateBp: 0, label: "0%" },
  { rateBp: 500, label: "5%" },
  { rateBp: 1200, label: "12%" },
  { rateBp: 1800, label: "18%" },
  { rateBp: 2800, label: "28%" },
  { rateBp: 300, label: "3%" },
];

export const DEFAULT_HSN = [
  { code: "996334", description: "Outdoor catering services", isService: true, defaultRateBp: 500, uqc: "OTH" },
  { code: "996331", description: "Restaurant / food serving services", isService: true, defaultRateBp: 500, uqc: "OTH" },
  { code: "996337", description: "Other contract food services", isService: true, defaultRateBp: 500, uqc: "OTH" },
  { code: "1006", description: "Rice", isService: false, defaultRateBp: 0, uqc: "KGS", supplyKind: "nil" },
  { code: "0701", description: "Potatoes, fresh", isService: false, defaultRateBp: 0, uqc: "KGS", supplyKind: "nil" },
  { code: "1507", description: "Edible oil", isService: false, defaultRateBp: 500, uqc: "LTR" },
  { code: "0910", description: "Spices", isService: false, defaultRateBp: 500, uqc: "KGS" },
  { code: "2711", description: "LPG for commercial use", isService: false, defaultRateBp: 1800, uqc: "NOS" },
  { code: "3924", description: "Plastic tableware and disposables", isService: false, defaultRateBp: 1800, uqc: "NOS" },
  { code: "998599", description: "Other support services (labour, rentals)", isService: true, defaultRateBp: 1800, uqc: "OTH" },
];

/** Idempotent: business row, default tax rates, starter HSN/SAC codes. */
export async function seed(db: Db): Promise<void> {
  await getBusiness(db);
  await db.insert(taxRates).values(DEFAULT_RATES).onConflictDoNothing();
  await db.insert(hsnCodes).values(DEFAULT_HSN.map((h) => ({ supplyKind: "taxable", ...h }))).onConflictDoNothing();
}

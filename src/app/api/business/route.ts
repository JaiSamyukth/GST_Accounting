import { eq } from "drizzle-orm";
import { z } from "zod";
import { business } from "@/db/schema";
import { audit } from "@/lib/audit";
import { stateCode } from "@/lib/docs-input";
import { checkGstin, isValidPan } from "@/lib/gst/gstin";
import { readJson, unprocessable } from "@/lib/http";
import { paise } from "@/lib/money";
import { route } from "@/lib/route";
import { getBusiness } from "@/lib/settings";

const schema = z.object({
  legalName: z.string().trim().min(1, "Legal name is required").max(200),
  tradeName: z.string().trim().max(200).default(""),
  gstin: z.string().trim().toUpperCase().default(""),
  pan: z.string().trim().toUpperCase().default(""),
  address: z.string().max(500).default(""),
  stateCode,
  jurisdiction: z.string().max(200).default(""),
  registrationType: z.enum(["regular", "composition"]).default("regular"),
  filingFrequency: z.enum(["monthly", "quarterly"]),
  fyStartYear: z.number().int().min(2017).max(2100),
  phone: z.string().max(50).default(""),
  email: z.string().max(200).default(""),
  invoicePrefix: z.string().max(10).regex(/^[A-Za-z0-9/\-]*$/, "Prefix may contain only letters, digits, / and -").default("INV-"),
  b2clLimit: z.string().default("100000"),
  noItcScheme: z.boolean().default(false),
  roundOff: z.boolean().default(true),
  defaultPriceMode: z.enum(["exclusive", "inclusive"]).default("exclusive"),
});

export const GET = route({}, async ({ db }) => ({ business: await getBusiness(db) }));

export const PUT = route({ owner: true }, async ({ req, db, user }) => {
  const input = await readJson(req, schema);
  if (input.gstin) {
    const g = checkGstin(input.gstin);
    if (!g.valid) throw unprocessable(g.errors[0]);
    if (g.stateCode !== input.stateCode) throw unprocessable("GSTIN state code does not match the selected state");
    if (input.pan && g.pan !== input.pan) throw unprocessable("PAN does not match the GSTIN");
    input.pan = g.pan ?? input.pan;
  }
  if (input.pan && !isValidPan(input.pan)) throw unprocessable("PAN is not valid");
  let b2clLimit: number;
  try {
    b2clLimit = paise(input.b2clLimit);
  } catch {
    throw unprocessable("B2C large limit is not a valid amount");
  }
  if (b2clLimit <= 0) throw unprocessable("B2C large limit must be more than zero");
  const before = await getBusiness(db);
  const [after] = await db.update(business).set({ ...input, b2clLimit, updatedAt: new Date() }).where(eq(business.id, 1)).returning();
  await audit(db, user, { action: "update", entityType: "business", entityId: 1, summary: "Business settings updated", before, after });
  return { business: after };
});

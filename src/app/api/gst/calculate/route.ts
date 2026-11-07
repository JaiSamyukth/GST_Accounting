import { z } from "zod";
import { lineSchema, stateCode, toEngineLine } from "@/lib/docs-input";
import { calcDocument, isIntraState } from "@/lib/gst/gst";
import { readJson } from "@/lib/http";
import { route } from "@/lib/route";
import { getBusiness } from "@/lib/settings";

const schema = z.object({
  placeOfSupply: stateCode,
  /** For purchases: the supplier's state. Omit for sales. */
  supplierStateCode: stateCode.optional(),
  priceMode: z.enum(["exclusive", "inclusive"]).default("exclusive"),
  isExport: z.boolean().default(false),
  exportWithIgst: z.boolean().default(false),
  roundOff: z.boolean().optional(),
  lines: z.array(lineSchema).min(1).max(500),
});

/** Live preview only; the saved document is recomputed on the server. */
export const POST = route({}, async ({ req, db }) => {
  const input = await readJson(req, schema);
  const biz = await getBusiness(db);
  const intraState = input.supplierStateCode
    ? input.supplierStateCode === input.placeOfSupply
    : isIntraState(input.isExport ? "96" : input.placeOfSupply, biz.stateCode, input.isExport);
  return calcDocument(input.lines.map(toEngineLine), {
    intraState, priceMode: input.priceMode, isExport: input.isExport, exportWithIgst: input.exportWithIgst,
    roundOff: input.roundOff ?? (input.supplierStateCode ? false : biz.roundOff),
  });
});

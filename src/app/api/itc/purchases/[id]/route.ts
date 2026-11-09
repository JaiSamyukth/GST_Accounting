import { z } from "zod";
import { updatePurchaseItc } from "@/lib/docs";
import { periodKey } from "@/lib/docs-input";
import { idParam, readJson } from "@/lib/http";
import { route } from "@/lib/route";

const schema = z.object({
  itcPeriod: periodKey.optional(),
  lines: z.array(z.object({ id: z.number().int().positive(), itcEligible: z.boolean(), itcReason: z.string().max(200).optional() })).optional(),
});

export const PATCH = route<{ id: string }>({}, async ({ req, db, user, params }) => {
  return { purchase: await updatePurchaseItc(db, user, idParam(params.id), await readJson(req, schema)) };
});

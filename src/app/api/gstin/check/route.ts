import { z } from "zod";
import { checkGstin } from "@/lib/gst/gstin";
import { readJson } from "@/lib/http";
import { route } from "@/lib/route";

export const POST = route({}, async ({ req }) => {
  const { gstin } = await readJson(req, z.object({ gstin: z.string().max(30) }));
  return checkGstin(gstin);
});

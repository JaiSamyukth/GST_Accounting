import { z } from "zod";
import { cancelPurchase } from "@/lib/docs";
import { idParam, readJson } from "@/lib/http";
import { route } from "@/lib/route";

export const POST = route<{ id: string }>({}, async ({ req, db, user, params }) => {
  const { reason } = await readJson(req, z.object({ reason: z.string().trim().min(1, "Give a reason").max(200) }));
  return { purchase: await cancelPurchase(db, user, idParam(params.id), reason) };
});

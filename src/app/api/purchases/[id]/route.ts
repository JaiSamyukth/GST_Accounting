import { getPurchase, updatePurchase } from "@/lib/docs";
import { purchaseSchema } from "@/lib/docs-input";
import { idParam, readJson } from "@/lib/http";
import { route } from "@/lib/route";

export const GET = route<{ id: string }>({}, async ({ db, params }) => getPurchase(db, idParam(params.id)));

export const PUT = route<{ id: string }>({}, async ({ req, db, user, params }) => {
  const doc = await updatePurchase(db, user, idParam(params.id), await readJson(req, purchaseSchema));
  return { purchase: doc };
});

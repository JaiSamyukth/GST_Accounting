import { getSale, updateSale } from "@/lib/docs";
import { saleSchema } from "@/lib/docs-input";
import { idParam, readJson } from "@/lib/http";
import { route } from "@/lib/route";

export const GET = route<{ id: string }>({}, async ({ db, params }) => getSale(db, idParam(params.id)));

export const PUT = route<{ id: string }>({}, async ({ req, db, user, params }) => {
  const doc = await updateSale(db, user, idParam(params.id), await readJson(req, saleSchema));
  return { sale: doc };
});

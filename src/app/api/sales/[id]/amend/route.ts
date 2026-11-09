import { z } from "zod";
import { amendSale } from "@/lib/amend";
import { periodKey, saleSchema } from "@/lib/docs-input";
import { badRequest, idParam, json } from "@/lib/http";
import { route } from "@/lib/route";

/** Body: the revised document (same shape as a sale) plus `amendPeriod` (YYYY-MM or YYYY-Qn). */
export const POST = route<{ id: string }>({}, async ({ req, db, user, params }) => {
  const body: unknown = await req.json().catch(() => {
    throw badRequest("Request body must be JSON");
  });
  const { amendPeriod } = z.object({ amendPeriod: periodKey }).parse(body);
  const doc = await amendSale(db, user, idParam(params.id), saleSchema.parse(body), amendPeriod);
  return json({ sale: doc }, 201);
});

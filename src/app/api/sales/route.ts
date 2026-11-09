import { createSale, listSales } from "@/lib/docs";
import { saleSchema } from "@/lib/docs-input";
import { json, readJson } from "@/lib/http";
import { listFilter } from "@/lib/query";
import { route } from "@/lib/route";

export const GET = route({}, async ({ req, db }) => {
  const sp = new URL(req.url).searchParams;
  return listSales(db, { ...listFilter(sp), section: sp.get("section") || undefined });
});

export const POST = route({}, async ({ req, db, user }) => {
  const doc = await createSale(db, user, await readJson(req, saleSchema));
  return json({ sale: doc }, 201);
});

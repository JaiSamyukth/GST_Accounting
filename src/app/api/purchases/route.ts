import { createPurchase, listPurchases } from "@/lib/docs";
import { purchaseSchema } from "@/lib/docs-input";
import { isPeriodKey } from "@/lib/gst/periods";
import { json, readJson } from "@/lib/http";
import { listFilter } from "@/lib/query";
import { route } from "@/lib/route";

export const GET = route({}, async ({ req, db }) => {
  const sp = new URL(req.url).searchParams;
  const itc = sp.get("itc");
  const itcPeriod = sp.get("itcPeriod");
  return listPurchases(db, {
    ...listFilter(sp),
    itc: itc === "eligible" || itc === "ineligible" ? itc : undefined,
    itcPeriod: itcPeriod && isPeriodKey(itcPeriod) ? itcPeriod : undefined,
  });
});

export const POST = route({}, async ({ req, db, user }) => {
  const doc = await createPurchase(db, user, await readJson(req, purchaseSchema));
  return json({ purchase: doc }, 201);
});

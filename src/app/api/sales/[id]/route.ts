import { getSale, updateSale } from "@/lib/docs";
import { saleSchema } from "@/lib/docs-input";
import { periodOf } from "@/lib/gst/periods";
import { AMENDMENT_SECTION } from "@/lib/gst/returns";
import { idParam, readJson } from "@/lib/http";
import { lockedPeriods } from "@/lib/locks";
import { route } from "@/lib/route";
import { getBusiness } from "@/lib/settings";

export const GET = route<{ id: string }>({}, async ({ db, params }) => {
  const s = await getSale(db, idParam(params.id));
  const biz = await getBusiness(db);
  const period = s.doc.amendPeriod ?? periodOf(s.doc.date, biz.filingFrequency);
  const locked = (await lockedPeriods(db, [period])).length > 0;
  const amendable = locked && s.doc.status === "active" && !s.doc.amendedById && !!AMENDMENT_SECTION[s.doc.section];
  return { ...s, period, locked, amendable };
});

export const PUT = route<{ id: string }>({}, async ({ req, db, user, params }) => {
  const doc = await updateSale(db, user, idParam(params.id), await readJson(req, saleSchema));
  return { sale: doc };
});

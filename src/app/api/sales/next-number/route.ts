import { nextSalesNumber } from "@/lib/docs";
import { route } from "@/lib/route";

export const GET = route({}, async ({ req, db }) => {
  const t = new URL(req.url).searchParams.get("docType");
  const docType = t === "credit_note" || t === "debit_note" ? t : "invoice";
  return { number: await nextSalesNumber(db, docType) };
});

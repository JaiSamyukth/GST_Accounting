import { z } from "zod";
import { isoDate } from "@/lib/docs-input";
import { rupeesField } from "@/lib/fields";
import { isPeriodKey } from "@/lib/gst/periods";
import { notFound, readJson } from "@/lib/http";
import { recordPayment } from "@/lib/returns-service";
import { route } from "@/lib/route";

function key(params: { key: string }): string {
  if (!isPeriodKey(params.key)) throw notFound("Unknown period");
  return params.key;
}

const schema = z.object({
  paidIgst: rupeesField("IGST"),
  paidCgst: rupeesField("CGST"),
  paidSgst: rupeesField("SGST"),
  paidCess: rupeesField("Cess"),
  interest: rupeesField("Interest"),
  lateFee: rupeesField("Late fee"),
  challanRef: z.string().trim().max(50).default(""),
  paidOn: isoDate.nullable().default(null),
});

export const POST = route<{ key: string }>({}, async ({ req, db, user, params }) => {
  return { status: await recordPayment(db, user, key(params), await readJson(req, schema)) };
});

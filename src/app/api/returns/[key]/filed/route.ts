import { z } from "zod";
import { isoDate } from "@/lib/docs-input";
import { isPeriodKey } from "@/lib/gst/periods";
import { notFound, readJson } from "@/lib/http";
import { markFiled } from "@/lib/returns-service";
import { route } from "@/lib/route";

function key(params: { key: string }): string {
  if (!isPeriodKey(params.key)) throw notFound("Unknown period");
  return params.key;
}

const schema = z.object({
  ret: z.enum(["gstr1", "gstr3b"]),
  arn: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{10,20}$/, "ARN should be 10 to 20 letters and digits"),
  filedOn: isoDate,
});

export const POST = route<{ key: string }>({}, async ({ req, db, user, params }) => {
  const { ret, arn, filedOn } = await readJson(req, schema);
  return { status: await markFiled(db, user, key(params), ret, arn, filedOn) };
});

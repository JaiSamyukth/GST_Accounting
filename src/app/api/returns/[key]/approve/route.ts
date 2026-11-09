import { z } from "zod";
import { isPeriodKey } from "@/lib/gst/periods";
import { notFound, readJson } from "@/lib/http";
import { approve } from "@/lib/returns-service";
import { route } from "@/lib/route";

function key(params: { key: string }): string {
  if (!isPeriodKey(params.key)) throw notFound("Unknown period");
  return params.key;
}

export const POST = route<{ key: string }>({ owner: true }, async ({ req, db, user, params }) => {
  const { ret } = await readJson(req, z.object({ ret: z.enum(["gstr1", "gstr3b", "both"]).default("both") }));
  return { status: await approve(db, user, key(params), ret) };
});

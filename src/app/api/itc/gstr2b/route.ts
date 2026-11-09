import { asc, eq } from "drizzle-orm";
import { gstr2bEntries } from "@/db/schema";
import { parse2bFile, TwoBError } from "@/lib/gst/gstr2b";
import { isPeriodKey } from "@/lib/gst/periods";
import { json, unprocessable } from "@/lib/http";
import { import2b } from "@/lib/itc-service";
import { MAX_FILE_BYTES, MAX_FILE_LABEL } from "@/lib/limits";
import { route } from "@/lib/route";

export const GET = route({}, async ({ req, db }) => {
  const period = new URL(req.url).searchParams.get("period") ?? "";
  if (!isPeriodKey(period)) throw unprocessable("Give a period");
  return { entries: await db.select().from(gstr2bEntries).where(eq(gstr2bEntries.period, period)).orderBy(asc(gstr2bEntries.id)) };
});

/** multipart: period, file (portal JSON/ZIP, or CSV/XLSX). Replaces the period's 2B rows. */
export const POST = route({}, async ({ req, db, user }) => {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_FILE_BYTES + 64 * 1024) throw unprocessable(`The file is larger than ${MAX_FILE_LABEL}`);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw unprocessable("Send the file as multipart/form-data");
  }
  const period = String(form.get("period") ?? "");
  if (!isPeriodKey(period)) throw unprocessable("Choose the period this GSTR-2B belongs to");
  const file = form.get("file");
  if (!(file instanceof File)) throw unprocessable("Choose a file to upload");
  let rows;
  try {
    rows = await parse2bFile(new Uint8Array(await file.arrayBuffer()), file.name);
  } catch (e) {
    if (e instanceof TwoBError) throw unprocessable(e.message);
    throw e;
  }
  return json(await import2b(db, user, period, rows, file.name), 201);
});

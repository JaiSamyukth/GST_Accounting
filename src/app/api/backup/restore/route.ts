import { restoreBackup } from "@/lib/backup";
import { unprocessable } from "@/lib/http";
import { MAX_FILE_BYTES, MAX_FILE_LABEL } from "@/lib/limits";
import { route } from "@/lib/route";

/** multipart: file = backup ZIP. Owner only; the installation must have no business data yet. */
export const POST = route({ owner: true }, async ({ req, db, user }) => {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_FILE_BYTES + 64 * 1024) throw unprocessable(`The backup is larger than ${MAX_FILE_LABEL}. Restore it from the command line: npm run backup:restore -- <file.zip>`);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw unprocessable("Send the backup as multipart/form-data");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw unprocessable("Choose the backup ZIP");
  return { restored: await restoreBackup(db, user, new Uint8Array(await file.arrayBuffer())) };
});

import { audit } from "@/lib/audit";
import { buildBackup } from "@/lib/backup";
import { attachment } from "@/lib/http";
import { route } from "@/lib/route";

/** Owner-only ZIP with one JSON file per table. Password hashes and session tokens are left out. */
export const GET = route({ owner: true }, async ({ db, user }) => {
  const zip = await buildBackup(db);
  await audit(db, user, { action: "export", entityType: "backup", summary: "Full backup downloaded" });
  const stamp = new Date().toISOString().slice(0, 10);
  return attachment(Buffer.from(zip), `gst-backup-${stamp}.zip`, "application/zip");
});

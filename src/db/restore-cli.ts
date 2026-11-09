// Restore a backup ZIP into an empty installation: npm run backup:restore -- gst-backup-2026-11-30.zip
import { readFileSync } from "node:fs";
import { restoreBackup } from "../lib/backup";
import { HttpError } from "../lib/http";
import { getDb } from "./client";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run backup:restore -- <backup.zip>");
  process.exit(1);
}
try {
  const counts = await restoreBackup(await getDb(), null, new Uint8Array(readFileSync(file)));
  console.log("Restored:", counts);
  process.exit(0);
} catch (e) {
  console.error(e instanceof HttpError ? e.message : e);
  process.exit(1);
}

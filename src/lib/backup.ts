// Full backup (ZIP of JSON per table) and restore into an empty installation.
import { getTableColumns, getTableName, sql, type InferInsertModel } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { Db } from "../db/client";
import * as s from "../db/schema";
import { audit } from "./audit";
import type { SessionUser } from "./auth";
import { conflict, unprocessable } from "./http";

/** Insert order respects foreign keys. Users, sessions and reset tokens are never part of a backup. */
export const BACKUP_TABLES: Array<[string, PgTable]> = [
  ["business", s.business], ["tax_rates", s.taxRates], ["hsn_codes", s.hsnCodes], ["parties", s.parties],
  ["sales_docs", s.salesDocs], ["sales_lines", s.salesLines], ["purchases", s.purchases], ["purchase_lines", s.purchaseLines],
  ["itc_adjustments", s.itcAdjustments], ["gstr2b_entries", s.gstr2bEntries], ["return_periods", s.returnPeriods],
  ["import_batches", s.importBatches], ["documents", s.documents], ["audit_log", s.auditLog], ["login_history", s.loginHistory],
];

/** Tables that must be empty before a restore: the business records themselves. */
const BUSINESS_DATA = ["parties", "sales_docs", "purchases", "itc_adjustments", "gstr2b_entries", "return_periods", "import_batches", "documents"];

export const BACKUP_VERSION = 1;

export async function buildBackup(db: Db): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const counts: Record<string, number> = {};
  for (const [name, table] of BACKUP_TABLES) {
    const rows = await db.select().from(table);
    counts[name] = rows.length;
    files[`${name}.json`] = strToU8(JSON.stringify(rows, null, 1));
  }
  const userRows = await db.select({ id: s.users.id, email: s.users.email, name: s.users.name, role: s.users.role, isActive: s.users.isActive, createdAt: s.users.createdAt }).from(s.users);
  files["users.json"] = strToU8(JSON.stringify(userRows, null, 1));
  files["manifest.json"] = strToU8(JSON.stringify({ app: "gst-invoice", version: BACKUP_VERSION, takenAt: new Date().toISOString(), tables: counts }, null, 1));
  files["README.txt"] = strToU8(
    `GST-Invoice backup taken ${new Date().toISOString()}.\nMoney values are integer paise; rates are basis points.\n` +
    "Attachments themselves are in object storage; documents.json lists their keys.\n" +
    "users.json is for reference only: user accounts and passwords are not restored.\n",
  );
  return zipSync(files);
}

function reviveRow(table: PgTable, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(getTableColumns(table))) {
    if (!(key in row)) continue;
    const v = row[key];
    // JSON turned timestamps into strings; Drizzle wants Date objects back.
    out[key] = col.columnType === "PgTimestamp" && typeof v === "string" ? new Date(v) : v;
  }
  return out;
}

/**
 * Restore a backup ZIP into an installation that has no business data yet (a fresh setup).
 * Users stay as they are in this installation. Settings, rates, HSN codes and the audit log
 * are replaced by the backup's.
 */
export async function restoreBackup(db: Db, user: Pick<SessionUser, "id" | "email"> | null, zip: Uint8Array) {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip);
  } catch {
    throw unprocessable("That is not a ZIP file. Choose the gst-backup-….zip downloaded from Settings → Backup.");
  }
  const read = (name: string): unknown => {
    const f = files[name];
    if (!f) return undefined;
    try {
      return JSON.parse(strFromU8(f));
    } catch {
      throw unprocessable(`${name} in the backup is damaged`);
    }
  };
  const manifest = read("manifest.json") as { app?: string; version?: number } | undefined;
  if (manifest && (manifest.app !== "gst-invoice" || (manifest.version ?? 0) > BACKUP_VERSION)) {
    throw unprocessable("This backup is from a different or newer application version");
  }
  if (!files["business.json"] || !files["sales_docs.json"]) throw unprocessable("This ZIP is not a GST-Invoice backup");
  const data = new Map<string, Record<string, unknown>[]>();
  for (const [name] of BACKUP_TABLES) {
    const rows = read(`${name}.json`) ?? [];
    if (!Array.isArray(rows) || rows.some((r) => !r || typeof r !== "object")) throw unprocessable(`${name}.json in the backup is not a list of rows`);
    data.set(name, rows as Record<string, unknown>[]);
  }

  return db.transaction(async (tx) => {
    for (const name of BUSINESS_DATA) {
      const r = await tx.execute(sql.raw(`select 1 from ${name} limit 1`));
      const rows = (r as unknown as { rows?: unknown[] }).rows ?? (r as unknown as unknown[]);
      if (rows.length) throw conflict("Restore only works on a fresh installation with no sales, purchases, parties or returns yet. Set up a new database first.");
    }
    // Replace defaults created at setup (and this installation's short audit trail).
    for (const name of ["login_history", "audit_log", "hsn_codes", "tax_rates", "business"]) await tx.execute(sql.raw(`delete from ${name}`));
    const counts: Record<string, number> = {};
    for (const [name, table] of BACKUP_TABLES) {
      const rows = data.get(name)!.map((r) => reviveRow(table, r));
      counts[name] = rows.length;
      for (let i = 0; i < rows.length; i += 500) {
        await tx.insert(table).values(rows.slice(i, i + 500) as InferInsertModel<typeof table>[]);
      }
      if (name !== "business") {
        const t = getTableName(table);
        await tx.execute(sql.raw(`select setval(pg_get_serial_sequence('${t}', 'id'), greatest((select coalesce(max(id), 0) from ${t}), 1))`));
      }
    }
    await audit(tx, user, { action: "restore", entityType: "backup", summary: `Restored backup: ${counts.sales_docs} sales, ${counts.purchases} purchases, ${counts.parties} parties` });
    return counts;
  });
}

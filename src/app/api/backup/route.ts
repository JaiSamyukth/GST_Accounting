import { strToU8, zipSync } from "fflate";
import * as schema from "@/db/schema";
import { audit } from "@/lib/audit";
import { attachment } from "@/lib/http";
import { route } from "@/lib/route";

/** Owner-only ZIP with one JSON file per table. Password hashes and session tokens are left out. */
export const GET = route({ owner: true }, async ({ db, user }) => {
  const tables = {
    business: schema.business, tax_rates: schema.taxRates, hsn_codes: schema.hsnCodes, parties: schema.parties,
    sales_docs: schema.salesDocs, sales_lines: schema.salesLines, purchases: schema.purchases, purchase_lines: schema.purchaseLines,
    itc_adjustments: schema.itcAdjustments, gstr2b_entries: schema.gstr2bEntries, return_periods: schema.returnPeriods,
    import_batches: schema.importBatches, documents: schema.documents, audit_log: schema.auditLog, login_history: schema.loginHistory,
  };
  const files: Record<string, Uint8Array> = {};
  for (const [name, table] of Object.entries(tables)) {
    files[`${name}.json`] = strToU8(JSON.stringify(await db.select().from(table), null, 1));
  }
  const userRows = await db.select({ id: schema.users.id, email: schema.users.email, name: schema.users.name, role: schema.users.role, isActive: schema.users.isActive, createdAt: schema.users.createdAt }).from(schema.users);
  files["users.json"] = strToU8(JSON.stringify(userRows, null, 1));
  files["README.txt"] = strToU8(`GST-Invoice backup taken ${new Date().toISOString()}.\nMoney values are integer paise; rates are basis points.\nAttachments themselves are in object storage; documents.json lists their keys.\n`);
  await audit(db, user, { action: "export", entityType: "backup", summary: "Full backup downloaded" });
  const stamp = new Date().toISOString().slice(0, 10);
  return attachment(Buffer.from(zipSync(files)), `gst-backup-${stamp}.zip`, "application/zip");
});

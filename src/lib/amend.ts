import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { salesDocs } from "../db/schema";
import type { SessionUser } from "./auth";
import { computeSale, getSale, insertSale } from "./docs";
import type { SaleInput } from "./docs-input";
import { periodOf, periodRange } from "./gst/periods";
import { AMENDMENT_SECTION, portalNumber } from "./gst/returns";
import { conflict, unprocessable } from "./http";
import { lockedPeriods } from "./locks";
import { getBusiness } from "./settings";

/**
 * Amend a document whose period is filed and locked. The revised version is a new row
 * (`amends_id` → previous version) reported in `amendPeriod`: GSTR-1 shows it in
 * b2ba/b2cla/cdnra with full values, GSTR-3B takes only the difference.
 * The previous version stays untouched in its filed period.
 */
export async function amendSale(db: Db, user: SessionUser, id: number, input: SaleInput, amendPeriod: string) {
  return db.transaction(async (tx) => {
    const biz = await getBusiness(tx);
    const { doc: prev } = await getSale(tx, id);
    if (prev.status === "cancelled") throw conflict("A cancelled document cannot be amended");
    if (prev.amendedById) throw conflict("This document already has an amendment. Amend the latest version instead.");
    if (input.docType !== prev.docType) throw unprocessable("The document type cannot be changed");
    if (!AMENDMENT_SECTION[prev.section]) {
      throw unprocessable(`${prev.section.toUpperCase()} documents cannot be amended here. Issue a credit or debit note instead.`);
    }
    const origPeriod = prev.amendPeriod ?? periodOf(prev.date, biz.filingFrequency);
    if (!(await lockedPeriods(tx, [origPeriod])).length) {
      throw unprocessable(`Period ${origPeriod} is not filed and locked. Edit the document directly.`);
    }
    if (periodRange(amendPeriod).from <= periodRange(origPeriod).to) {
      throw unprocessable("The amendment must be reported in a later period than the original");
    }
    const { section } = computeSale(input, biz);
    if (section !== prev.section) {
      throw unprocessable(`This change would move the document to section ${section.toUpperCase()}. Issue a credit note and a new invoice instead.`);
    }
    const m = /~A(\d*)$/.exec(prev.number);
    const n = m ? Number(m[1] || "1") + 1 : 1;
    const number = `${portalNumber(prev.number)}~A${n > 1 ? n : ""}`;
    const revised = await insertSale(tx, user, input, { number, amendsId: prev.id, amendPeriod, lockPeriods: [amendPeriod] });
    await tx.update(salesDocs).set({ amendedById: revised.id, updatedAt: new Date() }).where(eq(salesDocs.id, prev.id));
    return revised;
  });
}

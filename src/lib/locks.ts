import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "../db/client";
import { returnPeriods } from "../db/schema";
import { periodOf, type Frequency } from "./gst/periods";
import { conflict } from "./http";

export async function lockedPeriods(db: Tx, keys: string[]): Promise<string[]> {
  const unique = [...new Set(keys.filter(Boolean))];
  if (!unique.length) return [];
  const rows = await db
    .select({ period: returnPeriods.period })
    .from(returnPeriods)
    .where(and(inArray(returnPeriods.period, unique), eq(returnPeriods.locked, true)));
  return rows.map((r) => r.period);
}

/**
 * Reject a write that touches a locked period. Pass every date the write touches
 * (old and new) and every period key (e.g. ITC period, old and new).
 */
export async function assertUnlocked(
  db: Tx, freq: Frequency, opts: { dates?: Array<string | null | undefined>; periods?: Array<string | null | undefined> },
): Promise<void> {
  const keys = [
    ...(opts.dates ?? []).filter((d): d is string => !!d).map((d) => periodOf(d, freq)),
    ...(opts.periods ?? []).filter((p): p is string => !!p),
  ];
  const locked = await lockedPeriods(db, keys);
  if (locked.length) throw conflict(`Period ${locked.join(", ")} is locked. Unlock it from Returns to make changes.`);
}

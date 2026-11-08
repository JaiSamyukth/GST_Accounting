import { eq } from "drizzle-orm";
import type { Tx } from "../db/client";
import { business } from "../db/schema";

export type Business = typeof business.$inferSelect;

export async function getBusiness(db: Tx): Promise<Business> {
  const rows = await db.select().from(business).where(eq(business.id, 1)).limit(1);
  if (rows[0]) return rows[0];
  await db.insert(business).values({ id: 1 }).onConflictDoNothing();
  const again = await db.select().from(business).where(eq(business.id, 1)).limit(1);
  return again[0];
}

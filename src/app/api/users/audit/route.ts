import { desc, eq } from "drizzle-orm";
import { auditLog } from "@/db/schema";
import { route } from "@/lib/route";

export const GET = route({ owner: true }, async ({ req, db }) => {
  const sp = new URL(req.url).searchParams;
  const entity = sp.get("entity_type");
  const page = Math.max(Number(sp.get("page") ?? 1) || 1, 1);
  const rows = await db.select({
    id: auditLog.id, at: auditLog.at, userEmail: auditLog.userEmail, action: auditLog.action,
    entityType: auditLog.entityType, entityId: auditLog.entityId, summary: auditLog.summary,
  }).from(auditLog).where(entity ? eq(auditLog.entityType, entity) : undefined)
    .orderBy(desc(auditLog.at), desc(auditLog.id)).limit(100).offset((page - 1) * 100);
  return { audit: rows, page };
});

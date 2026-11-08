import type { Tx } from "../db/client";
import { auditLog } from "../db/schema";
import type { SessionUser } from "./auth";

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | number | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
}

export async function audit(db: Tx, user: Pick<SessionUser, "id" | "email"> | null, e: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    userId: user?.id ?? null,
    userEmail: user?.email ?? null,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId == null ? null : String(e.entityId),
    summary: e.summary ?? "",
    before: e.before ?? null,
    after: e.after ?? null,
  });
}

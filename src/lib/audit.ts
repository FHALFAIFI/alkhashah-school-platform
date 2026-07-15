import "server-only";
import { db } from "@/db";
import { auditLog } from "@/db/schema";

export async function audit(entry: {
  actorId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  summary?: string;
  detail?: unknown;
  ip?: string;
}) {
  await db.insert(auditLog).values({
    actorId: entry.actorId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    summary: entry.summary,
    detail: entry.detail as object | undefined,
    ip: entry.ip,
  });
}

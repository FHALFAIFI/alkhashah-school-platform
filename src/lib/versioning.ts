import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { recordVersions } from "@/db/schema";

/**
 * حفظ نسخة كاملة من سجل عند الاعتماد أو إعادة الفتح — التاريخ لا يفقد أبداً.
 */
export async function snapshotRecord(opts: {
  entityType: string;
  entityId: string;
  action: "created" | "approved" | "reopened" | "updated";
  snapshot: unknown;
  reason?: string;
  actorId?: string;
}) {
  const [latest] = await db
    .select({ version: recordVersions.version })
    .from(recordVersions)
    .where(and(eq(recordVersions.entityType, opts.entityType), eq(recordVersions.entityId, opts.entityId)))
    .orderBy(desc(recordVersions.version))
    .limit(1);
  const version = (latest?.version ?? 0) + 1;
  await db.insert(recordVersions).values({
    entityType: opts.entityType,
    entityId: opts.entityId,
    version,
    action: opts.action,
    reason: opts.reason,
    snapshot: opts.snapshot as object,
    actorId: opts.actorId,
  });
  return version;
}

export async function getVersions(entityType: string, entityId: string) {
  return db
    .select()
    .from(recordVersions)
    .where(and(eq(recordVersions.entityType, entityType), eq(recordVersions.entityId, entityId)))
    .orderBy(desc(recordVersions.version));
}

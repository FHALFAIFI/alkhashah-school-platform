import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  evidenceItems, evidenceLinks, programs, meetings, perfSessions, programDeliverables,
} from "@/db/schema";

/**
 * قاعدة إلزامية: لا يحذف شاهد مرتبط بسجل معتمد.
 * يفحص حالة كل سجل مرتبط بالشاهد.
 */
export async function canDeleteEvidence(evidenceId: string): Promise<{ allowed: boolean; reason?: string }> {
  const links = await db.select().from(evidenceLinks).where(eq(evidenceLinks.evidenceId, evidenceId));
  if (links.length === 0) return { allowed: true };

  const approvedStates = new Set(["معتمد", "معتمدة", "مقفل", "مقفلة", "مكتمل", "مكتملة"]);

  const byType = new Map<string, string[]>();
  for (const l of links) {
    const arr = byType.get(l.entityType) ?? [];
    arr.push(l.entityId);
    byType.set(l.entityType, arr);
  }

  const checks: { table: "program" | "meeting" | "perf_session" | "deliverable"; ids: string[] }[] = [];
  for (const [type, ids] of byType) {
    if (type === "program") checks.push({ table: "program", ids });
    if (type === "meeting") checks.push({ table: "meeting", ids });
    if (type === "perf_session" || type === "perf_rating") checks.push({ table: "perf_session", ids });
    if (type === "deliverable") checks.push({ table: "deliverable", ids });
  }

  for (const c of checks) {
    if (c.table === "program") {
      const rows = await db.select({ s: programs.status }).from(programs).where(inArray(programs.id, c.ids));
      if (rows.some((r) => approvedStates.has(r.s))) return { allowed: false, reason: "الشاهد مرتبط ببرنامج معتمد" };
    }
    if (c.table === "meeting") {
      const rows = await db.select({ s: meetings.status }).from(meetings).where(inArray(meetings.id, c.ids));
      if (rows.some((r) => approvedStates.has(r.s))) return { allowed: false, reason: "الشاهد مرتبط باجتماع مكتمل" };
    }
    if (c.table === "perf_session") {
      const rows = await db.select({ s: perfSessions.status }).from(perfSessions).where(inArray(perfSessions.id, c.ids));
      if (rows.some((r) => approvedStates.has(r.s) || r.s === "مقفلة")) return { allowed: false, reason: "الشاهد مرتبط بجلسة أداء مقفلة" };
    }
    if (c.table === "deliverable") {
      const rows = await db
        .select({ s: programDeliverables.packageDecision })
        .from(programDeliverables)
        .where(inArray(programDeliverables.id, c.ids));
      if (rows.some((r) => r.s === "معتمد" || r.s === "معتمدة")) return { allowed: false, reason: "الشاهد ضمن حزمة معتمدة" };
    }
  }

  return { allowed: true };
}

export async function linkEvidence(opts: {
  evidenceId: string;
  entityType: string;
  entityId: string;
  subKey?: string;
  linkedBy?: string;
}) {
  await db
    .insert(evidenceLinks)
    .values({
      evidenceId: opts.evidenceId,
      entityType: opts.entityType,
      entityId: opts.entityId,
      subKey: opts.subKey ?? "",
      linkedBy: opts.linkedBy,
    })
    .onConflictDoNothing();
}

export async function evidenceForEntity(entityType: string, entityId: string) {
  return db
    .select({
      link: evidenceLinks,
      item: evidenceItems,
    })
    .from(evidenceLinks)
    .innerJoin(evidenceItems, eq(evidenceLinks.evidenceId, evidenceItems.id))
    .where(and(eq(evidenceLinks.entityType, entityType), eq(evidenceLinks.entityId, entityId)));
}

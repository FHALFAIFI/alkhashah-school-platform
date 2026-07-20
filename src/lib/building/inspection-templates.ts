import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { inspectionTemplates } from "@/db/schema";
import { getSetting } from "@/lib/settings";

/**
 * Phase 3 — واجهة قوالب الفحص المعتمِدة على قاعدة البيانات (server-only).
 * التعريفات النقية (أنواع/ثوابت/دوال) في inspection-template-defs.ts وتُعاد تصديرها هنا.
 */
export * from "./inspection-template-defs";

/** رمز عائلة القالب التالي — KHS-TPL-0001 ... يعدّ العائلات المميزة (rootId). */
export async function nextTemplateCode(executor: Pick<typeof db, "select"> = db): Promise<string> {
  const prefix = await getSetting("inspection_templates.code_prefix", "KHS-TPL-");
  const [{ count }] = await executor
    .select({ count: sql<number>`count(distinct coalesce(${inspectionTemplates.rootId}, ${inspectionTemplates.id}))::int` })
    .from(inspectionTemplates);
  return `${prefix}${String(count + 1).padStart(4, "0")}`;
}

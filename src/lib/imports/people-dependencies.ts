import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  people,
  committeeMembers,
  perfCycles,
  personStages,
  actionTasks,
  maintenanceIssues,
  programs,
  users,
} from "@/db/schema";

/**
 * تدقيق التبعيات قبل التراجع الكامل عن دفعة استيراد الأشخاص.
 *
 * التراجع الكامل يحذف الأشخاص الذين أنشأتهم الدفعة. يجب ألا يحدث ذلك إن ارتبط أي منهم
 * بسجل عمل لاحق — فالتراجع يجب ألا يحذف أو يعدّل سجلات العمل المرتبطة (لا حذف تعاقبي).
 *
 * تُحصى كل مواضع الإشارة إلى معرّف الشخص في قاعدة البيانات (روابط رسمية + إشارات لينة بلا قيد):
 *   1) committee_members.person_id     — عضويات اللجان
 *   2) perf_cycles.person_id           — دورات تقييم الأداء
 *   3) person_stages.person_id         — مراحل التدريس المسندة (قيدها تعاقبي — نمنع الحذف الصامت)
 *   4) action_tasks.owner_person_id    — المهام/الإجراءات المسندة
 *   5) maintenance_issues.owner_person_id — بلاغات الصيانة المسندة
 *   6) programs.owner_person_id        — برامج الخطة التي يملكها الشخص
 *   7) users.person_id                 — حسابات الدخول المرتبطة بالشخص
 *
 * الاجتماعات لا تشير إلى الأشخاص بمعرّف مباشر (لا حضور ولا غياب) — ارتباطها يمر عبر
 * عضويات اللجان، فهي مغطاة ضمن (1).
 *
 * ملاحظة صيانة: `personDependencies` في `src/lib/safe-delete.ts` يفحص المواضع السبعة
 * نفسها لشخص واحد (زائد الشواهد والوثائق) لحارس الحذف النهائي. هذه الدالة تبقى مستقلة
 * لأنها تعمل داخل معاملة التراجع على مجموعة معرّفات دفعة كاملة. أي موضع إشارة جديد
 * للشخص يجب أن يُضاف في الموضعين معاً.
 */

export type PeopleDependency = { type: string; labelAr: string; count: number };

export type PeopleRollbackPreflight = {
  importedCount: number;
  /** الأنواع التي لها ارتباطات فعلية فقط (count > 0) */
  dependencies: PeopleDependency[];
  /** يُمنع التراجع الكامل عند وجود أي ارتباط */
  blocked: boolean;
};

/** يقبل قاعدة البيانات أو معاملة نشطة — الحصر للقراءة فقط. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

 
async function countRefs(exec: Executor, table: any, column: any, ids: string[]): Promise<number> {
  const [row] = await exec
    .select({ c: sql<number>`count(*)::int` })
    .from(table)
    .where(inArray(column, ids));
  return row?.c ?? 0;
}

/**
 * يحسب تبعيات أشخاص دفعة معيّنة. لا يكتب شيئاً.
 * يُستعمل من صفحة الدفعة (عرض) ومن حارس التراجع داخل المعاملة (الحكم النهائي).
 */
export async function peopleBatchDependencies(exec: Executor, batchId: string): Promise<PeopleRollbackPreflight> {
  const imported = await exec.select({ id: people.id }).from(people).where(eq(people.importBatchId, batchId));
  const ids = imported.map((p) => p.id);
  if (ids.length === 0) return { importedCount: 0, dependencies: [], blocked: false };

  const raw: PeopleDependency[] = [
    { type: "committee_members", labelAr: "عضويات لجان", count: await countRefs(exec, committeeMembers, committeeMembers.personId, ids) },
    { type: "perf_cycles", labelAr: "دورات تقييم أداء", count: await countRefs(exec, perfCycles, perfCycles.personId, ids) },
    { type: "person_stages", labelAr: "مراحل تدريس مسندة", count: await countRefs(exec, personStages, personStages.personId, ids) },
    { type: "action_tasks", labelAr: "مهام وإجراءات مسندة", count: await countRefs(exec, actionTasks, actionTasks.ownerPersonId, ids) },
    { type: "maintenance_issues", labelAr: "بلاغات صيانة مسندة", count: await countRefs(exec, maintenanceIssues, maintenanceIssues.ownerPersonId, ids) },
    { type: "programs", labelAr: "برامج خطة يملكها الشخص", count: await countRefs(exec, programs, programs.ownerPersonId, ids) },
    { type: "users", labelAr: "حسابات دخول مرتبطة", count: await countRefs(exec, users, users.personId, ids) },
  ];

  const dependencies = raw.filter((d) => d.count > 0);
  return { importedCount: ids.length, dependencies, blocked: dependencies.length > 0 };
}

/** ملخص عربي مختصر لأنواع التبعيات وأعدادها — لرسائل الخطأ والتدقيق. */
export function dependencySummaryAr(deps: PeopleDependency[]): string {
  return deps.map((d) => `${d.labelAr}: ${d.count}`).join("، ");
}

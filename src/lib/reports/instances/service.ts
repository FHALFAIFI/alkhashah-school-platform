import "server-only";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { reportCounters, reportInstances, reportOutputs } from "@/db/schema";
import { audit } from "@/lib/audit";
import { getSetting } from "@/lib/settings";
import { hijriPartsOf, isValidIsoDate } from "@/lib/dates";
import { filtersToStored, parseReportFilters, storedToParams, type ReportFilters } from "../filters";
import { buildSnapshot, SnapshotPermissionError } from "./snapshot";
import {
  instanceTypeByKey,
  isSensitiveType,
  requiredPermissions,
  INSTANCE_DRAFT,
  INSTANCE_FINAL,
  INSTANCE_ARCHIVED,
} from "./types";
import { parseInstanceOptions, readSnapshot, type InstanceOptions, type SnapshotDoc } from "./options";

/**
 * خدمة التقارير المحفوظة (v2.6 — D-055). القواعد هنا هي قواعد النطاق حرفياً:
 * المسودة وحدها تُعدَّل وتُحذف؛ الاعتماد معاملة واحدة **متكرّرة التنفيذ بأمان**؛ الرقم
 * يُمنح عند الاعتماد فقط من عدّاد مقفول؛ النسخة الجديدة تقرير جديد يشير إلى أصله؛
 * الأرشفة تحويل حالة لا يمسّ المحتوى. والقادح في القاعدة (الهجرة 0035) يحرس كل ذلك
 * تحت هذه الخدمة، فخطأ مستقبلي فيها يفشل بصوت عالٍ بدل أن يعدّل لقطة.
 *
 * ── الصلاحيات (D-055) ─────────────────────────────────────────────────────────
 * لا مفاتيح جديدة: التأليف `reports.builder`، والاطلاع `reports.read`، والاعتماد ورفع
 * النسخة الموقّعة `documents.issue`. التقرير الحسّاس (قسم أداء فردي) يشترط فوق ذلك
 * `performance.individual.read` في كل مسار قراءة وتصدير — الأرشيف لا يفتح ما أغلقه D-013.
 */

type Viewer = { id: string; permissions: Set<string> };

export type InstanceResult = { error?: string; success?: string; instanceId?: string; reportNumber?: string };

export const INSTANCE_TITLE_MAX = 200;

export type InstanceRow = typeof reportInstances.$inferSelect;

/** هل يجوز لهذا الناظر رؤية هذا التقرير أصلاً؟ (الحساسية قبل كل شيء) */
function canView(row: InstanceRow, viewer: Viewer): boolean {
  if (!viewer.permissions.has("reports.read")) return false;
  if (row.sensitive && !viewer.permissions.has("performance.individual.read")) return false;
  return true;
}

export async function getInstance(id: string, viewer: Viewer): Promise<InstanceRow | null> {
  const [row] = await db.select().from(reportInstances).where(eq(reportInstances.id, id));
  if (!row || !canView(row, viewer)) return null;
  return row;
}

/** لقطة تقرير معتمد — أو بناء حيّ للمسودة (المعاينة). المصدر واحد في الحالين (D-060) */
export async function instanceDocument(row: InstanceRow, viewer: Viewer): Promise<SnapshotDoc> {
  if (row.status !== INSTANCE_DRAFT) {
    const doc = readSnapshot(row.snapshot);
    if (!doc) throw new Error("لقطة التقرير غير قابلة للقراءة");
    return doc;
  }
  return buildSnapshot({
    instanceId: row.id,
    typeKey: row.typeKey,
    title: row.title,
    storedFilters: row.filters,
    storedOptions: row.options,
    periodFrom: row.periodFrom,
    periodTo: row.periodTo,
    viewer,
  });
}

/* ─────────────────────────── البحث في الأرشيف (§B) ─────────────────────────── */

export type ArchiveSearch = {
  search?: string;
  statuses?: string[];
  typeKeys?: string[];
  dateFrom?: string;
  dateTo?: string;
  page?: number;
};

export const ARCHIVE_PAGE_SIZE = 25;

export async function searchInstances(criteria: ArchiveSearch, viewer: Viewer) {
  // دفاع في العمق: الخدمة نفسها ترفض بلا صلاحية الاطلاع — لا اعتماداً على حارس الصفحة وحده
  if (!viewer.permissions.has("reports.read")) {
    return { rows: [] as InstanceRow[], total: 0, page: 1, pageSize: ARCHIVE_PAGE_SIZE };
  }
  const conds = [];
  const term = criteria.search?.trim().slice(0, 120);
  if (term) {
    const like = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    conds.push(or(ilike(reportInstances.title, like), ilike(reportInstances.reportNumber, like)));
  }
  const statuses = criteria.statuses?.filter((s) => ["مسودة", "نهائي", "مؤرشف"].includes(s));
  if (statuses?.length) conds.push(inArray(reportInstances.status, statuses));
  if (criteria.typeKeys?.length) conds.push(inArray(reportInstances.typeKey, criteria.typeKeys.slice(0, 20)));
  if (criteria.dateFrom && isValidIsoDate(criteria.dateFrom))
    conds.push(gte(reportInstances.createdAt, new Date(`${criteria.dateFrom}T00:00:00.000Z`)));
  if (criteria.dateTo && isValidIsoDate(criteria.dateTo))
    conds.push(lte(reportInstances.createdAt, new Date(`${criteria.dateTo}T23:59:59.999Z`)));
  // D-013: الحسّاس لا يظهر في القائمة أصلاً لمن لا يملك الصلاحية الفردية
  if (!viewer.permissions.has("performance.individual.read")) conds.push(eq(reportInstances.sensitive, false));

  const where = conds.length ? and(...conds) : undefined;
  const page = Math.max(1, Math.min(10_000, criteria.page ?? 1));
  const rows = await db
    .select()
    .from(reportInstances)
    .where(where)
    .orderBy(desc(reportInstances.createdAt))
    .limit(ARCHIVE_PAGE_SIZE)
    .offset((page - 1) * ARCHIVE_PAGE_SIZE);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reportInstances)
    .where(where);
  return { rows, total: count, page, pageSize: ARCHIVE_PAGE_SIZE };
}

/* ─────────────────────────── الإنشاء والتعديل ─────────────────────────── */

export type InstanceInput = {
  title?: string;
  typeKey: string;
  filters?: ReportFilters;
  options?: unknown;
  periodFrom?: string | null;
  periodTo?: string | null;
};

function validateInput(input: InstanceInput, viewer: Viewer): { error: string } | { options: InstanceOptions; title: string } {
  const typeDef = instanceTypeByKey(input.typeKey);
  if (!typeDef) return { error: "نوع تقرير غير معروف" };
  const options = parseInstanceOptions(input.options);
  if (typeDef.key === "single" && !options.reportKey) return { error: "اختر التقرير المصدر أولاً" };
  const missing = requiredPermissions(input.typeKey, options).filter((p) => !viewer.permissions.has(p));
  if (missing.length > 0) return { error: "لا تملك صلاحية كل أقسام هذا النوع" };
  const title = (input.title ?? "").trim().slice(0, INSTANCE_TITLE_MAX) || typeDef.labelAr;
  const from = input.periodFrom ?? undefined;
  const to = input.periodTo ?? undefined;
  if (from && !isValidIsoDate(from)) return { error: "تاريخ بداية الفترة غير صحيح" };
  if (to && !isValidIsoDate(to)) return { error: "تاريخ نهاية الفترة غير صحيح" };
  return { options, title };
}

export async function createInstance(input: InstanceInput, viewer: Viewer): Promise<InstanceResult> {
  if (!viewer.permissions.has("reports.builder")) return { error: "لا تملك صلاحية إنشاء التقارير" };
  const checked = validateInput(input, viewer);
  if ("error" in checked) return checked;

  const [row] = await db
    .insert(reportInstances)
    .values({
      title: checked.title,
      typeKey: input.typeKey,
      filters: input.filters ? filtersToStored(input.filters) : {},
      options: checked.options as Record<string, unknown>,
      periodFrom: input.periodFrom ?? null,
      periodTo: input.periodTo ?? null,
      sensitive: isSensitiveType(input.typeKey, checked.options),
      createdBy: viewer.id,
      updatedBy: viewer.id,
    })
    .returning();

  await audit({
    actorId: viewer.id,
    action: "report_instance.created",
    entityType: "report_instance",
    entityId: row.id,
    summary: `إنشاء مسودة تقرير «${row.title}»`,
    detail: { typeKey: row.typeKey },
  });
  return { success: `أُنشئت مسودة «${row.title}»`, instanceId: row.id };
}

export async function updateInstance(id: string, input: InstanceInput, viewer: Viewer): Promise<InstanceResult> {
  if (!viewer.permissions.has("reports.builder")) return { error: "لا تملك صلاحية تعديل التقارير" };
  const row = await getInstance(id, viewer);
  if (!row) return { error: "التقرير غير موجود" };
  if (row.status !== INSTANCE_DRAFT) return { error: "التقرير النهائي لا يُعدَّل — أنشئ نسخة جديدة منه (§A)" };
  const checked = validateInput(input, viewer);
  if ("error" in checked) return checked;

  await db
    .update(reportInstances)
    .set({
      title: checked.title,
      filters: input.filters ? filtersToStored(input.filters) : {},
      options: checked.options as Record<string, unknown>,
      periodFrom: input.periodFrom ?? null,
      periodTo: input.periodTo ?? null,
      sensitive: isSensitiveType(row.typeKey, checked.options),
      updatedBy: viewer.id,
      updatedAt: new Date(),
    })
    .where(eq(reportInstances.id, id));

  await audit({
    actorId: viewer.id,
    action: "report_instance.updated",
    entityType: "report_instance",
    entityId: id,
    summary: `تعديل مسودة تقرير «${checked.title}»`,
  });
  return { success: "حُفظت المسودة", instanceId: id };
}

export async function deleteDraft(id: string, viewer: Viewer): Promise<InstanceResult> {
  if (!viewer.permissions.has("reports.builder")) return { error: "لا تملك صلاحية حذف المسودات" };
  const row = await getInstance(id, viewer);
  if (!row) return { error: "التقرير غير موجود" };
  if (row.status !== INSTANCE_DRAFT) return { error: "المسودة وحدها تُحذف — التقرير النهائي محفوظ دائماً (§A)" };

  await db.delete(reportInstances).where(eq(reportInstances.id, id));
  await audit({
    actorId: viewer.id,
    action: "report_instance.deleted",
    entityType: "report_instance",
    entityId: id,
    summary: `حذف مسودة تقرير «${row.title}»`,
    detail: { typeKey: row.typeKey, status: row.status },
  });
  return { success: `حُذفت المسودة «${row.title}»` };
}

/** نسخ تقرير سابق مسودةً جديدة — الوصفة تُنسخ، اللقطة والرقم لا يُنسخان أبداً (§A) */
export async function copyInstance(id: string, viewer: Viewer): Promise<InstanceResult> {
  if (!viewer.permissions.has("reports.builder")) return { error: "لا تملك صلاحية إنشاء التقارير" };
  const row = await getInstance(id, viewer);
  if (!row) return { error: "التقرير غير موجود" };
  const missing = requiredPermissions(row.typeKey, parseInstanceOptions(row.options)).filter(
    (p) => !viewer.permissions.has(p),
  );
  if (missing.length > 0) return { error: "لا تملك صلاحية كل أقسام هذا التقرير" };

  const [copy] = await db
    .insert(reportInstances)
    .values({
      title: `${row.title} — نسخة`.slice(0, INSTANCE_TITLE_MAX),
      typeKey: row.typeKey,
      filters: row.filters,
      options: row.options,
      periodFrom: row.periodFrom,
      periodTo: row.periodTo,
      sensitive: row.sensitive,
      createdBy: viewer.id,
      updatedBy: viewer.id,
    })
    .returning();

  await audit({
    actorId: viewer.id,
    action: "report_instance.copied",
    entityType: "report_instance",
    entityId: copy.id,
    summary: `نسخ تقرير من «${row.title}»`,
    detail: { sourceInstanceId: id },
  });
  return { success: "أُنشئت مسودة من التقرير السابق", instanceId: copy.id };
}

/** نسخة جديدة من تقرير نهائي: تقرير جديد برقم جديد يشير إلى أصله (§A) */
export async function newVersion(id: string, viewer: Viewer): Promise<InstanceResult> {
  const row = await getInstance(id, viewer);
  if (!row) return { error: "التقرير غير موجود" };
  if (row.status === INSTANCE_DRAFT) return { error: "هذه مسودة تُعدَّل مباشرةً — النسخ الجديدة للتقارير النهائية" };
  const result = await copyInstance(id, viewer);
  if (result.error || !result.instanceId) return result;
  await db
    .update(reportInstances)
    .set({ versionOfId: id, title: row.title.slice(0, INSTANCE_TITLE_MAX) })
    .where(eq(reportInstances.id, result.instanceId));
  await audit({
    actorId: viewer.id,
    action: "report_instance.version_created",
    entityType: "report_instance",
    entityId: result.instanceId,
    summary: `نسخة جديدة من التقرير «${row.reportNumber ?? row.title}»`,
    detail: { versionOf: id, originalNumber: row.reportNumber },
  });
  return { success: `أُنشئت نسخة جديدة من «${row.title}» — تُعتمد برقم جديد`, instanceId: result.instanceId };
}

/* ─────────────────────────── الاعتماد النهائي ─────────────────────────── */

/**
 * رقم التقرير التالي — عدّاد سنة هجرية مقفول بـ`FOR UPDATE` داخل معاملة الاعتماد.
 * لا عدّ صفوف (سباق موثَّق في ترقيم الوثائق) ولا تسلسل عالمي (لا يبدأ من جديد كل سنة).
 */
async function nextReportNumber(tx: typeof db): Promise<string> {
  const prefix = await getSetting("reports.number_prefix", "KHS-RPT-");
  const yearKey = String(hijriPartsOf(new Date()).year);
  await tx
    .insert(reportCounters)
    .values({ yearKey, lastNumber: 0 })
    .onConflictDoNothing();
  const [counter] = await tx
    .select()
    .from(reportCounters)
    .where(eq(reportCounters.yearKey, yearKey))
    .for("update");
  const next = counter.lastNumber + 1;
  await tx.update(reportCounters).set({ lastNumber: next }).where(eq(reportCounters.yearKey, yearKey));
  return `${prefix}${yearKey}-${String(next).padStart(4, "0")}`;
}

/**
 * الاعتماد النهائي (§A): معاملة واحدة تقفل الصفّ، وتتحقق أنه ما زال مسودةً، وتجمّد
 * اللقطة، وتمنح الرقم. **متكرّر التنفيذ بأمان**: تقرير اعتُمد فعلاً يعيد رقمه القائم
 * بنجاح — فالنقر المزدوج والإعادة بعد انقطاع لا يمنحان رقمين ولا يكتبان لقطتين.
 *
 * ── قفل تفاؤلي على `updated_at` ─────────────────────────────────────────────
 * اللقطة تُبنى قبل المعاملة (قراءات ثقيلة لا يصح إمساك القفل خلالها) — وهذا يفتح سباقاً:
 * تعديلُ مسودةٍ يهبط بين بناء اللقطة وقفل الصفّ كان يجعل المعتمَد لقطةً من إعدادات
 * **أقدم** من المحفوظ. لذلك يُلتقط `updated_at` قبل البناء ويُقارن تحت القفل: إن تغيّر،
 * تُرمى اللقطة وتُبنى من جديد (بمحاولات محدودة) — فلا يُعتمد أبداً ما لم يُبنَ من آخر
 * حالةٍ للمسودة. الاختبار الحتمي: `finalize-race.test.ts`.
 */
const FINALIZE_MAX_ATTEMPTS = 3;

export async function finalizeInstance(id: string, viewer: Viewer): Promise<InstanceResult> {
  if (!viewer.permissions.has("documents.issue")) return { error: "اعتماد التقرير يتطلب صلاحية إصدار الوثائق" };

  for (let attempt = 1; attempt <= FINALIZE_MAX_ATTEMPTS; attempt++) {
    const row = await getInstance(id, viewer);
    if (!row) return { error: "التقرير غير موجود" };
    if (row.status === INSTANCE_FINAL || row.status === INSTANCE_ARCHIVED) {
      return { success: `التقرير معتمد فعلاً برقم ${row.reportNumber}`, instanceId: id, reportNumber: row.reportNumber ?? undefined };
    }
    const draftStamp = row.updatedAt.getTime();

    let doc: SnapshotDoc;
    try {
      doc = await buildSnapshot({
        instanceId: row.id,
        typeKey: row.typeKey,
        title: row.title,
        storedFilters: row.filters,
        storedOptions: row.options,
        periodFrom: row.periodFrom,
        periodTo: row.periodTo,
        viewer,
      });
    } catch (e) {
      if (e instanceof SnapshotPermissionError) return { error: e.message };
      return { error: e instanceof Error ? e.message : "تعذر بناء لقطة التقرير" };
    }

    let reportNumber = "";
    const outcome = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(reportInstances).where(eq(reportInstances.id, id)).for("update");
      if (!locked) return { error: "التقرير غير موجود" };
      if (locked.status !== INSTANCE_DRAFT) {
        return { success: `التقرير معتمد فعلاً برقم ${locked.reportNumber}`, reportNumber: locked.reportNumber ?? "" };
      }
      // المسودة تغيّرت بعد بناء اللقطة — لا يُعتمد بناءٌ من إعدادات قديمة (بلوكر §5)
      if (locked.updatedAt.getTime() !== draftStamp) return { stale: true as const };
      reportNumber = await nextReportNumber(tx as unknown as typeof db);
      await tx
        .update(reportInstances)
        .set({
          status: INSTANCE_FINAL,
          reportNumber,
          snapshot: doc as unknown as Record<string, unknown>,
          finalizedAt: new Date(),
          finalizedBy: viewer.id,
          updatedBy: viewer.id,
          updatedAt: new Date(),
        })
        .where(eq(reportInstances.id, id));
      return { reportNumber };
    });

    if ("stale" in outcome && outcome.stale) continue;
    if ("error" in outcome && outcome.error) return { error: outcome.error };
    if ("success" in outcome && outcome.success) {
      return { success: outcome.success, instanceId: id, reportNumber: outcome.reportNumber };
    }

    await audit({
      actorId: viewer.id,
      action: "report_instance.finalized",
      entityType: "report_instance",
      entityId: id,
      summary: `اعتماد التقرير «${row.title}» برقم ${reportNumber}`,
      detail: { reportNumber, sections: doc.stats.sectionCount, rows: doc.stats.totalRows, buildAttempt: attempt },
    });
    return { success: `اعتُمد التقرير برقم ${reportNumber}`, instanceId: id, reportNumber };
  }
  return { error: "المسودة تتغيّر أثناء الاعتماد — ثبّت التعديلات ثم أعد المحاولة" };
}

/* ─────────────────────────── الأرشفة والنسخة الموقّعة ─────────────────────────── */

export async function archiveInstance(id: string, viewer: Viewer): Promise<InstanceResult> {
  if (!viewer.permissions.has("reports.builder")) return { error: "لا تملك صلاحية أرشفة التقارير" };
  const row = await getInstance(id, viewer);
  if (!row) return { error: "التقرير غير موجود" };
  if (row.status !== INSTANCE_FINAL) return { error: "التقرير النهائي وحده يُؤرشف" };
  await db
    .update(reportInstances)
    .set({ status: INSTANCE_ARCHIVED, archivedAt: new Date(), archivedBy: viewer.id, updatedBy: viewer.id, updatedAt: new Date() })
    .where(eq(reportInstances.id, id));
  await audit({
    actorId: viewer.id,
    action: "report_instance.archived",
    entityType: "report_instance",
    entityId: id,
    summary: `أرشفة التقرير ${row.reportNumber} — المحتوى المجمّد لم يتغيّر`,
  });
  return { success: "أُرشف التقرير — محتواه المجمّد كما هو" };
}

export async function unarchiveInstance(id: string, viewer: Viewer): Promise<InstanceResult> {
  if (!viewer.permissions.has("reports.builder")) return { error: "لا تملك صلاحية استعادة التقارير" };
  const row = await getInstance(id, viewer);
  if (!row) return { error: "التقرير غير موجود" };
  if (row.status !== INSTANCE_ARCHIVED) return { error: "التقرير ليس مؤرشفاً" };
  await db
    .update(reportInstances)
    .set({ status: INSTANCE_FINAL, updatedBy: viewer.id, updatedAt: new Date() })
    .where(eq(reportInstances.id, id));
  await audit({
    actorId: viewer.id,
    action: "report_instance.unarchived",
    entityType: "report_instance",
    entityId: id,
    summary: `استعادة التقرير ${row.reportNumber} من الأرشيف`,
  });
  return { success: "استُعيد التقرير من الأرشيف" };
}

/**
 * ربط النسخة الموقّعة بعد التوقيع الخارجي (§B) — الملف محفوظ مسبقاً في التخزين.
 *
 * **لا حزمة قديمة قابلة للتنزيل ولو للحظة** (بلوكر §6): ربط النسخة وحذف صفّ ZIP القائم
 * يقعان في معاملة واحدة، فمنذ لحظة الربط لا يوجد إلا «لم تُجمَّع بعد» حتى تكتمل مهمة
 * إعادة التجميع — التي يدرجها المستدعي في سجل المهام بدورتها الكاملة (فشل مرئي وإعادة).
 */
export async function attachSignedCopy(id: string, fileId: string, viewer: Viewer): Promise<InstanceResult> {
  if (!viewer.permissions.has("documents.issue")) return { error: "رفع النسخة الموقّعة يتطلب صلاحية إصدار الوثائق" };
  const row = await getInstance(id, viewer);
  if (!row) return { error: "التقرير غير موجود" };
  if (row.status === INSTANCE_DRAFT) return { error: "النسخة الموقّعة تُرفع بعد اعتماد التقرير" };
  await db.transaction(async (tx) => {
    await tx
      .update(reportInstances)
      .set({ signedCopyFileId: fileId, updatedBy: viewer.id, updatedAt: new Date() })
      .where(eq(reportInstances.id, id));
    // الحزمة القائمة صارت ناقصة بالتعريف — تُزال فوراً وتُعاد جمعاً بمهمة مسجلة
    await tx
      .delete(reportOutputs)
      .where(and(eq(reportOutputs.instanceId, id), eq(reportOutputs.format, "zip")));
  });
  await audit({
    actorId: viewer.id,
    action: "report_instance.signed_copy_uploaded",
    entityType: "report_instance",
    entityId: id,
    summary: `رفع النسخة الموقّعة للتقرير ${row.reportNumber} — أُزيلت الحزمة القديمة وستُجمَّع من جديد`,
    detail: { fileId, previousFileId: row.signedCopyFileId },
  });
  return { success: "حُفظت النسخة الموقّعة — تُجمَّع الحزمة من جديد لتشملها", instanceId: id };
}

/* ─────────────────────────── مخرجات محفوظة ─────────────────────────── */

export async function instanceOutputs(instanceId: string) {
  return db.select().from(reportOutputs).where(eq(reportOutputs.instanceId, instanceId));
}

/** قراءة مرشّحات صفّ مخزَّن بتطهير كامل — الواجهة والتصدير يقرآن من هنا فقط */
export function instanceFilters(row: InstanceRow): ReportFilters {
  return parseReportFilters(storedToParams(row.filters));
}

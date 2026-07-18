import "server-only";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { importBatches, planYears, programs, perfModels, floors, floorGeometryVersions } from "@/db/schema";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { committedEmployeeCount, faresPreviewBatchId } from "@/lib/committees/prerequisites";

/**
 * القرارات الاستراتيجية المعلّقة أمام المدير — قرارات إعداد/تشغيل حقيقية لا عناصر يومية.
 * كل عنصر يربط مباشرة بالسجل/الإجراء المطلوب. تُحسب من الحالة الفعلية (لا كتابة).
 */
export type StrategicItem = {
  key: string;
  title: string;
  detail: string;
  href: string;
  action: string;
  status: string; // بانتظار قرارك | موقوف | مؤجل
};

export async function strategicPendingDecisions(): Promise<StrategicItem[]> {
  const items: StrategicItem[] = [];
  const excluded = await getExcludedIdSets();

  // 1) دفعة فارس بانتظار الاعتماد النهائي
  const faresId = await faresPreviewBatchId();
  if (faresId) {
    items.push({
      key: "fares",
      title: "دفعة فارس بانتظار اعتمادك النهائي",
      detail: "بيانات منسوبي المدرسة في «معاينة» — تنفيذها قرارك اليدوي وحدك، ويفتح تشكيل اللجان ودورات التقييم.",
      href: `/imports/${faresId}`,
      action: "راجع الدفعة ونفّذها",
      status: "بانتظار قرارك",
    });
  }

  // 2) الخطة التشغيلية مستوردة لكن البرامج بانتظار الاعتماد/الإقفال
  const [activeYear] = await db.select().from(planYears).where(eq(planYears.status, "نشطة"));
  if (activeYear) {
    const draftPrograms = await db
      .select({ id: programs.id })
      .from(programs)
      .where(and(eq(programs.planYearId, activeYear.id), eq(programs.status, "مسودة"), notSynthetic(programs.id, excluded.programs)));
    if (draftPrograms.length > 0) {
      items.push({
        key: "plan-approval",
        title: `الخطة التشغيلية مستوردة — ${draftPrograms.length} برنامجاً بانتظار الاعتماد`,
        detail: "البرامج الرسمية بحالة «مسودة» ولم تُعتمد بعد — اعتمادها يفتح المتابعة الأسبوعية وطلبات التغيير.",
        href: "/plan",
        action: "اعتمد البرامج",
        status: "بانتظار قرارك",
      });
    }
  }

  // 3) D-014 بانتظار مطابقة نظام فارس (نموذج رسمي أصلي فيه خلية معلّقة)
  const [d014Model] = await db
    .select({ id: perfModels.id, nameAr: perfModels.nameAr })
    .from(perfModels)
    .where(and(eq(perfModels.official, true), eq(perfModels.version, 1), inArray(perfModels.key, ["kindergarten-teacher", "school-vice", "school-principal"])))
    .limit(1);
  if (d014Model) {
    items.push({
      key: "d014",
      title: "D-014 — مؤشرات بانتظار المطابقة مع نظام فارس",
      detail: "ثلاث خلايا وزنها 5٪ في ملف النماذج مقابل 15٪ في الدليل — طابِقها مع فارس ثم أصدر نسخة نموذج معتمدة جديدة.",
      href: `/performance/models/${d014Model.id}`,
      action: "طابِق قيمة D-014",
      status: "بانتظار قرارك",
    });
  }

  // 4) و5) تشكيل اللجان ودورات التقييم موقوفة حتى اعتماد بيانات المنسوبين
  if ((await committedEmployeeCount()) === 0) {
    const href = faresId ? `/imports/${faresId}` : "/imports";
    items.push({
      key: "committees-blocked",
      title: "تشكيل اللجان موقوف حتى اعتماد بيانات المنسوبين",
      detail: "لا يوجد منسوبون معتمدون بعد — أعضاء اللجان من المنسوبين المعتمدين حصراً.",
      href,
      action: "اعتمد دفعة فارس أولاً",
      status: "موقوف",
    });
    items.push({
      key: "performance-blocked",
      title: "دورات تقييم الأداء موقوفة حتى اعتماد بيانات المنسوبين",
      detail: "الدورة تُنشأ لمنسوب معتمد — تعتمد على اعتماد دفعة فارس.",
      href,
      action: "اعتمد دفعة فارس أولاً",
      status: "موقوف",
    });
  }

  // 6) الطوابق العليا مسودات بانتظار المراجعة والنشر
  const upperFloors = await db.select().from(floors).where(inArray(floors.key, ["first", "second", "third"]));
  const upperIds = upperFloors.map((f) => f.id);
  const publishedRows = upperIds.length
    ? await db
        .select({ floorId: floorGeometryVersions.floorId })
        .from(floorGeometryVersions)
        .where(and(inArray(floorGeometryVersions.floorId, upperIds), eq(floorGeometryVersions.status, "منشورة")))
    : [];
  const publishedSet = new Set(publishedRows.map((r) => r.floorId));
  const unpublished = upperFloors.filter((f) => !publishedSet.has(f.id));
  if (unpublished.length > 0) {
    items.push({
      key: "upper-floors",
      title: `طوابق بانتظار مراجعتك ونشرها: ${unpublished.map((f) => f.nameAr).join("، ")}`,
      detail: "المخطط التشغيلي للطوابق العليا مسودة — راجعه مع الصورة المصدرية ثم انشره لمزامنة سجل الغرف.",
      href: `/building/editor/${unpublished[0].key}`,
      action: "راجع وانشر المخطط",
      status: "بانتظار قرارك",
    });
  }

  // 7) أرشفة السجلات التجريبية مؤجلة — عدّ خفيف للبرامج الاصطناعية (مرساة بنيوية فقط)
  const synthBatchIds = (await db.select({ id: importBatches.id }).from(importBatches).where(like(importBatches.sourceFileName, "%تجريبي%"))).map((b) => b.id);
  const demoYearIds = (await db.select({ id: planYears.id }).from(planYears).where(like(planYears.key, "demo%"))).map((y) => y.id);
  const anchors = [
    synthBatchIds.length ? inArray(programs.importBatchId, synthBatchIds) : undefined,
    demoYearIds.length ? inArray(programs.planYearId, demoYearIds) : undefined,
  ].filter(Boolean);
  const syntheticPrograms =
    anchors.length > 0 ? (await db.select({ c: sql<number>`count(*)::int` }).from(programs).where(or(...anchors)))[0]?.c ?? 0 : 0;
  if (syntheticPrograms > 0) {
    items.push({
      key: "archive-deferred",
      title: "أرشفة السجلات التجريبية مؤجلة",
      detail: `توجد سجلات اصطناعية (منها ${syntheticPrograms} برنامجاً) مخفية عن الواجهات بالمرشّح المركزي — الأرشفة الصريحة قرارك اليدوي.`,
      href: "/admin/cleanup",
      action: "راجع الأرشفة (مؤجلة)",
      status: "مؤجل",
    });
  }

  // 8) بوابة C5 مؤجلة بقرار مالك المنتج
  items.push({
    key: "c5-deferred",
    title: "بوابة C5 (الوصول الآمن والكاميرا والتطبيق المثبّت والعمل دون اتصال) مؤجلة",
    detail: "قرار مالك المنتج (D-018): التشغيل عبر الشبكة الحالية مع بدائل يدوية (فتح غرفة بالرمز، رفع ملف عادي).",
    href: "/admin/settings",
    action: "مؤجلة — لا إجراء مطلوب",
    status: "مؤجل",
  });

  return items;
}

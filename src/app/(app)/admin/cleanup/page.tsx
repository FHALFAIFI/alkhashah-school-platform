import { and, eq, notInArray, sql } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { programs, importBatches, planYears } from "@/db/schema";
import { PageHeader, Card, Badge, EmptyState } from "@/components/ui";
import {
  classifySynthetic,
  syntheticExclusionEnabled,
  type SyntheticCandidate,
  type SyntheticEntityType,
} from "@/lib/synthetic";

export const metadata = { title: "تنظيف السجلات التجريبية (معاينة)" };
export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<SyntheticEntityType, string> = {
  person: "الأشخاص",
  program: "البرامج",
  committee: "اللجان",
  meeting: "الاجتماعات",
  perf_cycle: "دورات الأداء",
  perf_session: "جلسات الأداء",
  task: "المهام",
  document: "الوثائق",
  evidence: "الشواهد",
  maintenance: "بلاغات الصيانة",
};

const TYPE_ORDER: SyntheticEntityType[] = [
  "person",
  "program",
  "committee",
  "meeting",
  "perf_cycle",
  "perf_session",
  "task",
  "document",
  "evidence",
  "maintenance",
];

function groupByType(items: SyntheticCandidate[]): Map<SyntheticEntityType, SyntheticCandidate[]> {
  const m = new Map<SyntheticEntityType, SyntheticCandidate[]>();
  for (const it of items) {
    const arr = m.get(it.entityType) ?? [];
    arr.push(it);
    m.set(it.entityType, arr);
  }
  return m;
}

export default async function CleanupPage() {
  await requirePermission("admin.settings");
  const c = await classifySynthetic();

  // إثبات السلامة: البرامج غير المصنّفة اصطناعية (تشمل البرامج الرسمية) تبقى ظاهرة
  const [{ total: totalPrograms }] = await db.select({ total: sql<number>`count(*)::int` }).from(programs);
  const preservedPrograms =
    c.ids.programs.size > 0
      ? (await db.select({ c: sql<number>`count(*)::int` }).from(programs).where(notInArray(programs.id, [...c.ids.programs])))[0].c
      : totalPrograms;

  // البرامج الرسمية المحفوظة حسب السنة التخطيطية (غير الاصطناعية)
  const officialByYear = await db
    .select({ year: planYears.nameAr, key: planYears.key, count: sql<number>`count(*)::int` })
    .from(programs)
    .innerJoin(planYears, eq(programs.planYearId, planYears.id))
    .where(c.ids.programs.size > 0 ? notInArray(programs.id, [...c.ids.programs]) : undefined)
    .groupBy(planYears.nameAr, planYears.key);

  // دفعات الاستيراد الحقيقية في «معاينة» (فارس وغيرها) — ليست ضمن الدفعات الاصطناعية
  const previewBatches = await db
    .select({ id: importBatches.id, name: importBatches.sourceFileName, type: importBatches.importType, status: importBatches.status })
    .from(importBatches)
    .where(
      c.syntheticBatchIds.length > 0
        ? and(eq(importBatches.status, "معاينة"), notInArray(importBatches.id, c.syntheticBatchIds))
        : eq(importBatches.status, "معاينة"),
    );

  const grouped = groupByType(c.candidates);
  const totalCandidates = c.candidates.length;
  const exclusionOn = syntheticExclusionEnabled();

  return (
    <div className="space-y-4">
      <PageHeader
        title="تنظيف السجلات التجريبية"
        subtitle="معاينة فقط — تحديد السجلات الاصطناعية بأدلة بنيوية، دون تنفيذ أي حذف"
        actions={<Badge value="معاينة" />}
      />

      {/* إشعار: معاينة فقط، لا تنفيذ */}
      <Card className="border-amber-300 bg-amber-50">
        <p className="font-bold text-amber-900">هذه الصفحة للمعاينة فقط — لا تُنفِّذ أي أرشفة أو حذف.</p>
        <p className="mt-1 text-sm text-amber-800">
          تحديد السجلات الاصطناعية يعتمد على أدلة بنيوية (دفعة استيراد اسم ملفها يحوي «تجريبي»، سنة
          تخطيطية للعرض، أو ارتباط بمفتاح أجنبي بكيان اصطناعي) — <b>وليس على الاسم وحده</b>. تنفيذ
          التنظيف الفعلي إجراء يدوي من المدير، ولم يُفعَّل في هذا الإصدار. المطلوب الآن مراجعة القوائم
          أدناه فقط.
        </p>
      </Card>

      {/* حالة الاستبعاد من اللوحات والتقارير والمساعد */}
      <Card className={exclusionOn ? "border-emerald-200 bg-emerald-50" : "border-sand-200"}>
        <p className="text-sm">
          استبعاد السجلات الاصطناعية من لوحات المتابعة والتقارير والإحصاءات وسياق المساعد الذكي:{" "}
          <span className={`font-bold ${exclusionOn ? "text-emerald-800" : "text-gray-600"}`}>
            {exclusionOn ? "مُفعَّل" : "معطّل (بيئة اختبار)"}
          </span>
        </p>
      </Card>

      {/* إثبات السلامة: البرامج الرسمية ودفعات المعاينة الحقيقية محفوظة */}
      <Card className="border-brand-200 bg-brand-50">
        <h2 className="mb-2 font-bold text-brand-900">محفوظ وآمن — لا يُشمل بالتنظيف</h2>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs text-gray-500">إجمالي البرامج</p>
            <p className="font-bold text-brand-900 tabular-nums">{totalPrograms}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">برامج محفوظة (غير اصطناعية)</p>
            <p className="font-bold text-emerald-800 tabular-nums">{preservedPrograms}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">برامج مصنّفة اصطناعية</p>
            <p className="font-bold text-amber-800 tabular-nums">{c.ids.programs.size}</p>
          </div>
        </div>
        {officialByYear.length > 0 && (
          <div className="mt-3 text-xs text-gray-700">
            <p className="mb-1 text-gray-500">البرامج المحفوظة حسب السنة التخطيطية:</p>
            <ul className="space-y-0.5">
              {officialByYear.map((y) => (
                <li key={y.key}>
                  <span className="font-medium">{y.year}</span>: <span className="tabular-nums">{y.count}</span> برنامجاً
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-3 border-t border-brand-100 pt-2 text-xs text-gray-700">
          <p className="mb-1 text-gray-500">دفعات الاستيراد الحقيقية في «معاينة» (تبقى دون مساس):</p>
          {previewBatches.length === 0 ? (
            <p className="text-gray-400">لا دفعات في المعاينة.</p>
          ) : (
            <ul className="space-y-0.5">
              {previewBatches.map((b) => (
                <li key={b.id}>
                  <span className="font-medium">{b.name}</span> — {b.status}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* المرشحون المؤكدون بنيوياً */}
      <Card>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="font-bold text-brand-900">سجلات اصطناعية مرشّحة للتنظيف (بأدلة بنيوية)</h2>
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${totalCandidates ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
            {totalCandidates}
          </span>
        </div>
        {totalCandidates === 0 ? (
          <EmptyState title="لا سجلات اصطناعية مرصودة بأدلة بنيوية" hint="قاعدة البيانات نظيفة من البيانات التجريبية الآلية" />
        ) : (
          <div className="space-y-3">
            {TYPE_ORDER.filter((t) => grouped.has(t)).map((t) => {
              const items = grouped.get(t)!;
              return (
                <details key={t} className="rounded-lg border border-sand-200 bg-white p-2">
                  <summary className="flex cursor-pointer items-center justify-between gap-2">
                    <span className="font-medium text-brand-900">{TYPE_LABELS[t]}</span>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 tabular-nums">{items.length}</span>
                  </summary>
                  <ul className="mt-2 space-y-1 border-t border-sand-100 pt-2 text-sm">
                    {items.map((it) => (
                      <li key={it.id} className="flex flex-col">
                        <span className="break-words font-medium text-gray-800">{it.label || "—"}</span>
                        <span className="text-xs text-gray-500">السبب: {it.reason}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        )}
      </Card>

      {/* مشتبَه بهم بالاسم فقط — لا يُشملون بالتنظيف التلقائي */}
      <Card className="border-sand-300">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="font-bold text-gray-700">مشتبَه بهم بالاسم فقط — يحتاجون تأكيداً يدوياً</h2>
          <span className="rounded-full bg-sand-100 px-2 py-0.5 text-xs font-bold text-gray-600 tabular-nums">
            {c.nameOnlySuspects.length}
          </span>
        </div>
        <p className="mb-2 text-xs text-gray-500">
          سجلات يحوي اسمها «تجريبي» لكن بلا دليل بنيوي — لا تُستبعَد ولا تؤرشَف تلقائياً، لتفادي حذف بيانات
          حقيقية بالخطأ. تُعرض هنا لمراجعة المدير فقط.
        </p>
        {c.nameOnlySuspects.length === 0 ? (
          <p className="py-2 text-sm text-gray-400">لا مشتبَه بهم بالاسم.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {c.nameOnlySuspects.map((s) => (
              <li key={`${s.entityType}-${s.id}`} className="flex flex-col">
                <span className="break-words">{TYPE_LABELS[s.entityType]}: {s.label}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* خطوة التأكيد — موصوفة، لا تُنفَّذ */}
      <Card className="border-red-200 bg-red-50/40">
        <h2 className="mb-1 font-bold text-red-900">تنفيذ التنظيف (خطوة المدير اليدوية)</h2>
        <p className="text-sm text-red-800">
          أرشفة السجلات المرشّحة أعلاه أو حذفها إجراء لا يُنفِّذه النظام آلياً. عند اعتماد القائمة، يتولى
          المدير التنفيذ يدوياً. حتى ذلك الحين تبقى هذه السجلات مستبعدة من اللوحات والتقارير والمساعد
          دون حذفها فعلياً.
        </p>
      </Card>
    </div>
  );
}

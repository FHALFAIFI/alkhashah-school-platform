import { and, eq, notInArray, sql } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { programs, importBatches, planYears } from "@/db/schema";
import { PageHeader, Card, Badge, EmptyState, SubmitButton } from "@/components/ui";
import {
  classifySynthetic,
  syntheticExclusionEnabled,
  SYNTHETIC_ENTITY_ORDER,
  type SyntheticCandidate,
  type SyntheticEntityType,
} from "@/lib/synthetic";
import { listArchiveBatches, ARCHIVE_CONFIRMATION_PHRASE } from "@/lib/cleanup-archive";
import { archiveSyntheticAction, unarchiveBatchAction } from "./actions";

export const metadata = { title: "تنظيف السجلات التجريبية (معاينة)" };
export const dynamic = "force-dynamic";

/** معرّف دفعة الخطة الرسمية المعتمدة (منفذة) — يجب أن تبقى محفوظة دون مساس */
const OFFICIAL_PLAN_BATCH_PREFIX = "385c615a";

const TYPE_LABELS: Record<SyntheticEntityType, string> = {
  plan_year: "سنة تخطيطية (عرض)",
  program: "البرامج",
  milestone: "المعالم",
  deliverable: "المخرجات",
  kpi: "مؤشرات الأداء",
  risk: "المخاطر",
  budget: "بنود الميزانية",
  roadmap_cell: "خلايا خارطة التنفيذ",
  followup: "المتابعات الأسبوعية",
  change_request: "طلبات التغيير",
  person: "الأشخاص",
  committee: "اللجان",
  meeting: "الاجتماعات",
  outcome: "نتائج الاجتماعات",
  perf_cycle: "دورات الأداء",
  perf_session: "جلسات الأداء",
  task: "المهام",
  document: "الوثائق",
  evidence: "الشواهد",
  maintenance: "بلاغات الصيانة",
};

/** المجموعات المطلوبة في المعاينة الدقيقة — كل مجموعة تجمع نوعاً أو أكثر */
const BUCKETS: { key: string; label: string; types: SyntheticEntityType[] }[] = [
  { key: "plans", label: "الخطط والبرامج", types: ["plan_year", "program"] },
  { key: "milestones", label: "المعالم", types: ["milestone"] },
  { key: "outputs", label: "المخرجات والشواهد", types: ["deliverable", "evidence"] },
  { key: "updates", label: "التحديثات والمتابعات", types: ["followup", "change_request"] },
  { key: "risks", label: "المخاطر", types: ["risk"] },
  { key: "budgets", label: "بنود الميزانية", types: ["budget"] },
  { key: "reports", label: "التقارير والوثائق", types: ["document"] },
  {
    key: "other",
    label: "سجلات تابعة أخرى",
    types: ["kpi", "roadmap_cell", "person", "committee", "meeting", "outcome", "perf_cycle", "perf_session", "task", "maintenance"],
  },
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
  const grouped = groupByType(c.candidates);
  const exclusionOn = syntheticExclusionEnabled();
  const totalCandidates = c.candidates.length;

  // إثبات السلامة — البرامج غير الاصطناعية (تشمل الرسمية) تبقى ظاهرة
  const [{ total: totalPrograms }] = await db.select({ total: sql<number>`count(*)::int` }).from(programs);
  const preservedPrograms =
    c.ids.programs.size > 0
      ? (await db.select({ n: sql<number>`count(*)::int` }).from(programs).where(notInArray(programs.id, [...c.ids.programs])))[0].n
      : totalPrograms;

  // البرامج المحفوظة حسب السنة التخطيطية (غير الاصطناعية)
  const officialByYear = await db
    .select({ year: planYears.nameAr, key: planYears.key, count: sql<number>`count(*)::int` })
    .from(programs)
    .innerJoin(planYears, eq(programs.planYearId, planYears.id))
    .where(c.ids.programs.size > 0 ? notInArray(programs.id, [...c.ids.programs]) : undefined)
    .groupBy(planYears.nameAr, planYears.key);

  // الدفعة الرسمية المعتمدة (385c615a) — عدد برامجها وكم منها مصنّف اصطناعياً (المتوقع 0)
  const [officialBatch] = await db
    .select({ id: importBatches.id, name: importBatches.sourceFileName, status: importBatches.status, type: importBatches.importType })
    .from(importBatches)
    .where(sql`${importBatches.id}::text like ${OFFICIAL_PLAN_BATCH_PREFIX + "%"}`);
  const officialProgramRows = officialBatch
    ? await db.select({ id: programs.id }).from(programs).where(eq(programs.importBatchId, officialBatch.id))
    : [];
  const officialProgramCount = officialProgramRows.length;
  const officialSyntheticCount = officialProgramRows.filter((p) => c.ids.programs.has(p.id)).length;

  // دفعات المعاينة الحقيقية (فارس وغيرها) — ليست ضمن الدفعات الاصطناعية
  const previewBatches = await db
    .select({ id: importBatches.id, name: importBatches.sourceFileName, type: importBatches.importType, status: importBatches.status })
    .from(importBatches)
    .where(
      c.syntheticBatchIds.length > 0
        ? and(eq(importBatches.status, "معاينة"), notInArray(importBatches.id, c.syntheticBatchIds))
        : eq(importBatches.status, "معاينة"),
    );
  const faresPreserved = previewBatches.some((b) => b.type === "people");

  // دفعات الأرشفة السابقة (إن وُجدت)
  let archiveBatchRows: Awaited<ReturnType<typeof listArchiveBatches>> = [];
  try {
    archiveBatchRows = await listArchiveBatches();
  } catch {
    archiveBatchRows = [];
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="تنظيف السجلات التجريبية"
        subtitle="معاينة دقيقة بأدلة بنيوية — أرشفة آمنة غير متلفة قابلة للتراجع الكامل، لا حذف نهائي"
        actions={<Badge value="معاينة" />}
      />

      {/* إشعار: معاينة، والتنفيذ إجراء يدوي من المدير */}
      <Card className="border-amber-300 bg-amber-50">
        <p className="font-bold text-amber-900">هذه الصفحة للمعاينة — لم يُنفَّذ أي تنظيف.</p>
        <p className="mt-1 text-sm text-amber-800">
          التحديد يعتمد على أدلة بنيوية (دفعة استيراد اسم ملفها يحوي «تجريبي»، سنة تخطيطية للعرض
          <span className="font-mono"> demo</span>، أو ارتباط بمفتاح أجنبي بكيان اصطناعي) — <b>وليس على الاسم وحده</b>.
          الأرشفة إجراء يدوي حاسم من المدير يتطلب كتابة عبارة تأكيد صريحة. الأرشفة <b>لا تحذف</b> أي سجل؛
          تُخفيه فقط وتحتفظ بلقطة كاملة له، ويمكن استرجاعه بالكامل في أي وقت.
        </p>
      </Card>

      {/* حالة الاستبعاد المركزي */}
      <Card className={exclusionOn ? "border-emerald-200 bg-emerald-50" : "border-sand-200"}>
        <p className="text-sm">
          الاستبعاد المركزي للسجلات الاصطناعية من كل الواجهات (الخطة والبرامج، المتابعة، سجل الشواهد،
          التقارير والتصديرات، اللوحة ومركز العمل، البحث، سياق المساعد وأدواته):{" "}
          <span className={`font-bold ${exclusionOn ? "text-emerald-800" : "text-gray-600"}`}>
            {exclusionOn ? "مُفعَّل" : "معطّل (بيئة اختبار)"}
          </span>
        </p>
      </Card>

      {/* المعاينة الدقيقة: عدد المرشحين حسب المجموعة */}
      <Card>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-bold text-brand-900">المعاينة الدقيقة — عدد المرشّحين للأرشفة حسب المجموعة</h2>
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${totalCandidates ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
            الإجمالي {totalCandidates}
          </span>
        </div>
        {totalCandidates === 0 ? (
          <EmptyState title="لا سجلات اصطناعية مرصودة بأدلة بنيوية" hint="قاعدة البيانات نظيفة من البيانات التجريبية الآلية" />
        ) : (
          <div className="space-y-3">
            {BUCKETS.map((bucket) => {
              const bucketItems = bucket.types.flatMap((t) => grouped.get(t) ?? []);
              const subCounts = bucket.types
                .map((t) => ({ t, n: c.counts[t] }))
                .filter((x) => x.n > 0);
              return (
                <div key={bucket.key} className="rounded-lg border border-sand-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-brand-900">{bucket.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${bucketItems.length ? "bg-amber-100 text-amber-800" : "bg-sand-100 text-gray-500"}`}>
                      {bucketItems.length}
                    </span>
                  </div>
                  {subCounts.length > 0 && (
                    <p className="mt-1 text-xs text-gray-500">
                      {subCounts.map((x) => `${TYPE_LABELS[x.t]}: ${x.n}`).join(" · ")}
                    </p>
                  )}
                  {bucketItems.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-brand-700">عرض السجلات والأسباب البنيوية</summary>
                      <ul className="mt-2 space-y-1 border-t border-sand-100 pt-2 text-sm">
                        {bucketItems.slice(0, 200).map((it) => (
                          <li key={`${it.entityType}-${it.id}`} className="flex flex-col">
                            <span className="break-words font-medium text-gray-800">
                              {TYPE_LABELS[it.entityType]}: {it.label || "—"}
                            </span>
                            <span className="text-xs text-gray-500">السبب: {it.reason}</span>
                          </li>
                        ))}
                        {bucketItems.length > 200 && (
                          <li className="text-xs text-gray-400">… و{bucketItems.length - 200} سجلاً آخر</li>
                        )}
                      </ul>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* إثبات السلامة: الدفعة الرسمية 385c615a ودفعة فارس محفوظتان */}
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
          <p className="mb-1 text-gray-500">الدفعة الرسمية المعتمدة (الخطة التشغيلية):</p>
          {officialBatch ? (
            <p>
              <span className="font-mono">{officialBatch.id.slice(0, 8)}</span> — {officialBatch.name} — {officialBatch.status} —{" "}
              <span className="tabular-nums">{officialProgramCount}</span> برنامجاً؛ منها مصنّف اصطناعياً:{" "}
              <span className={`font-bold tabular-nums ${officialSyntheticCount === 0 ? "text-emerald-700" : "text-red-700"}`}>{officialSyntheticCount}</span>
              {officialSyntheticCount === 0 ? " ✓ محفوظة بالكامل" : " — تحذير!"}
            </p>
          ) : (
            <p className="text-gray-400">لا توجد دفعة رسمية بالمعرّف {OFFICIAL_PLAN_BATCH_PREFIX}… في قاعدة البيانات الحالية.</p>
          )}
        </div>
        <div className="mt-2 border-t border-brand-100 pt-2 text-xs text-gray-700">
          <p className="mb-1 text-gray-500">
            دفعات «معاينة» الحقيقية (تشمل دفعة فارس) — تبقى دون مساس:{" "}
            <span className={`font-bold ${faresPreserved ? "text-emerald-700" : "text-gray-500"}`}>
              {faresPreserved ? "دفعة فارس محفوظة ✓" : "لا دفعة أشخاص في المعاينة"}
            </span>
          </p>
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

      {/* مشتبَه بهم بالاسم فقط — لا يُشملون بالأرشفة إلا باختيار يدوي صريح */}
      <Card className="border-sand-300">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="font-bold text-gray-700">سجلات بالاسم فقط — تتطلب اختياراً يدوياً</h2>
          <span className="rounded-full bg-sand-100 px-2 py-0.5 text-xs font-bold text-gray-600 tabular-nums">
            {c.nameOnlySuspects.length}
          </span>
        </div>
        <p className="mb-2 text-xs text-gray-500">
          سجلات يحوي اسمها «تجريبي» بلا دليل بنيوي — لا تُستبعَد ولا تؤرشَف تلقائياً تفادياً لحذف بيانات
          حقيقية بالخطأ. لأرشفتها يجب على المدير اختيارها صراحةً في نموذج الأرشفة أدناه.
        </p>
        {c.nameOnlySuspects.length === 0 ? (
          <p className="py-2 text-sm text-gray-400">لا مشتبَه بهم بالاسم.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {c.nameOnlySuspects.map((s) => (
              <li key={`${s.entityType}-${s.id}`} className="break-words">
                {TYPE_LABELS[s.entityType]}: {s.label}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* دفعات الأرشفة السابقة + الاسترجاع (التراجع الكامل) */}
      {archiveBatchRows.length > 0 && (
        <Card>
          <h2 className="mb-2 font-bold text-brand-900">دفعات الأرشفة</h2>
          <ul className="space-y-2 text-sm">
            {archiveBatchRows.map((b) => {
              const total = b.counts ? Object.values(b.counts).reduce((s, n) => s + n, 0) : 0;
              return (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sand-200 p-2">
                  <div className="min-w-0">
                    <span className="font-medium">{b.reason}</span>
                    <span className="mr-2 text-xs text-gray-500"> — {total} سجلاً — </span>
                    <Badge value={b.status} />
                  </div>
                  {b.status === "مؤرشف" && (
                    <form action={unarchiveBatchAction}>
                      <input type="hidden" name="batchId" value={b.id} />
                      <SubmitButton variant="secondary" confirmText="استرجاع كل سجلات هذه الدفعة وإعادتها للظهور؟">
                        استرجاع (تراجع كامل)
                      </SubmitButton>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* خطوة التنفيذ — نموذج الأرشفة (فعل المدير اليدوي). الوكيل لا يُنفِّذه. */}
      <Card className="border-red-200 bg-red-50/40">
        <h2 className="mb-1 font-bold text-red-900">تنفيذ الأرشفة (خطوة المدير اليدوية)</h2>
        <p className="mb-3 text-sm text-red-800">
          الأرشفة غير متلفة ومعاملاتية وتُسجَّل في سجل التدقيق، ويمكن التراجع عنها بالكامل. لتفعيلها اكتب عبارة
          التأكيد حرفياً: «<span className="font-mono font-bold">{ARCHIVE_CONFIRMATION_PHRASE}</span>». <b>لم يُنفِّذ الوكيل هذه الخطوة —
          تبقى بانتظار إجراء المدير.</b>
        </p>
        <form action={archiveSyntheticAction} className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">سبب الأرشفة (إلزامي)</span>
            <textarea
              name="reason"
              required
              minLength={3}
              rows={2}
              className="w-full rounded-lg border border-sand-300 p-2 text-sm"
              placeholder="مثال: أرشفة بيانات السيناريو الاصطناعية بعد اكتمال اختبار سير العمل"
            />
          </label>
          {c.nameOnlySuspects.length > 0 && (
            <fieldset className="rounded-lg border border-sand-200 p-2">
              <legend className="px-1 text-xs text-gray-500">تضمين سجلات «بالاسم فقط» (اختيار يدوي صريح — غير مُحدَّد افتراضياً)</legend>
              <div className="space-y-1">
                {c.nameOnlySuspects.map((s) => (
                  <label key={`${s.entityType}-${s.id}`} className="flex items-center gap-2 text-xs">
                    <input type="checkbox" name="manual" value={`${s.entityType}:${s.id}`} />
                    <span>{TYPE_LABELS[s.entityType]}: {s.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">عبارة التأكيد</span>
            <input
              name="confirmationText"
              required
              autoComplete="off"
              className="w-full rounded-lg border border-red-300 p-2 text-sm"
              placeholder={ARCHIVE_CONFIRMATION_PHRASE}
            />
          </label>
          <SubmitButton
            variant="danger"
            confirmText={`سيتم أرشفة ${totalCandidates} سجلاً اصطناعياً (أرشفة غير متلفة قابلة للتراجع). متابعة؟`}
          >
            تنفيذ الأرشفة الآن
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}

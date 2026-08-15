import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getPilotStatus } from "@/lib/pilot-status";
import { PageHeader, Card, Badge } from "@/components/ui";
import { RetestChecklist } from "./retest-checklist";

export const dynamic = "force-dynamic";

/** حالة عنصر: جاهز | بانتظار | مؤجل — لتلوين البطاقة */
type State = "ready" | "waiting" | "deferred" | "info";

const stateStyle: Record<State, string> = {
  ready: "border-emerald-200 bg-emerald-50",
  waiting: "border-amber-200 bg-amber-50",
  deferred: "border-slate-200 bg-slate-50",
  info: "border-sand-200 bg-white",
};
const stateLabel: Record<State, string> = {
  ready: "جاهز",
  waiting: "بانتظار إجراء",
  deferred: "مؤجّل",
  info: "معلومة",
};

function StatusCard({
  state,
  title,
  children,
  action,
}: {
  state: State;
  title: string;
  children?: React.ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div className={`rounded-xl border p-4 ${stateStyle[state]}`}>
      <div className="mb-1 flex items-start justify-between gap-2">
        <h3 className="font-bold text-brand-900">{title}</h3>
        <Badge value={stateLabel[state]} />
      </div>
      {children && <div className="text-sm text-gray-700">{children}</div>}
      {action && (
        <Link prefetch={false}
          href={action.href}
          className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 lg:min-h-0"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}

const CHECKLIST = [
  "راجع أسماء المنسوبين وتصنيفاتهم (معلم/موظف).",
  "راجع برامج الخطة التشغيلية الرسمية الـ26.",
  "اعتمد البرامج فردياً بعد مراجعتك لكل برنامج.",
  "شكّل لجنة واحدة حقيقية من قالب رسمي.",
  "اعقد اجتماعاً واحداً وأصدر محضراً موقّعاً.",
  "أنشئ دورة أداء واحدة مناسبة.",
  "افتح غرفة واحدة في الدور الأرضي وراجع أصولها وجاهزيتها.",
  "أرسل ملاحظة تشغيل واحدة على الأقل.",
  "راجع مركز الملاحظات في نهاية الأسبوع.",
];

const BOUNDARIES = [
  "لا يوجد سير عمل للحضور أو الغياب أو النصاب في اللجان — بحسب المتطلبات.",
  "إجراءات البريد تُنشئ مسودات فقط ولا تُرسل تلقائياً.",
  "حسابات دخول المنسوبين غير مفعّلة حالياً.",
  "التحرير الدقيق لهندسة المبنى يُفضَّل على الحاسب أو اللوحي.",
  "D-014: ثلاث خلايا وزن بانتظار المطابقة مع نظام فارس عند أول دورة تقييم حقيقية.",
  "الطوابق العليا مسودات بانتظار المراجعة والنشر (الدور الأرضي منشور).",
  "أرشفة السجلات التجريبية مؤجلة (قرار مالك المنتج) — مخفية تلقائياً عن الواجهات.",
  "بوابة C5 (الوصول الآمن/الكاميرا/التطبيق المثبّت/العمل دون اتصال) مؤجلة بقرار مالك المنتج مع بدائل يدوية.",
];

export default async function PilotPage() {
  await requireUser();
  const s = await getPilotStatus();

  const fmt = (d: Date | null) =>
    d
      ? new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", { dateStyle: "medium" }).format(d) +
        " · " +
        new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "short" }).format(d)
      : "—";

  const overallReady = s.fares.committed;

  return (
    <div>
      <PageHeader
        title="مركز التشغيل التجريبي"
        subtitle="حالة حيّة محسوبة من بيانات المنصة الفعلية — لا أرقام ثابتة."
      />

      {/* دعوة إعادة الاختبار + لوحة إعادة اختبار المدير (Phase 10) */}
      <Card className="mb-5 border-brand-200 bg-brand-50/50">
        <h2 className="mb-2 text-lg font-bold text-brand-900">دعوة لإعادة اختبار المنصة</h2>
        <div className="space-y-1.5 text-sm text-brand-900">
          <p>عزيزنا مدير المجمع، نُفّذت ملاحظات جولتك السادسة (ما بعد القبول) كاملةً في النسخة v2.4.0 — بياناتك الحقيقية كما هي، ولم يُمسّ أي سجل قائم:</p>
          <ul className="list-inside list-disc space-y-1 ps-1 text-gray-700">
            <li>المتبقي من المخصص ظاهر في كل شاشات الميزانية وتقاريرها، مع «المتبقي قبل/بعد» لكل عملية و«المتبقي بعد الحفظ» أثناء الإدخال.</li>
            <li>المتابعة الأسبوعية صادقة: لقطة الأسبوع المختار، وسم «لم يتم التحديث هذا الأسبوع»، وفصل الاكتمال الموثق عن الإقفال — لا برامج «مكتملة» بغير حق.</li>
            <li>القائمة الجانبية تُمرَّر من مكانها مباشرة وتحفظ موضعها أثناء التنقل وبعد التحديث، وأقسامها قابلة للطي.</li>
            <li>نماذج الأداء: حذف نهائي لغير المستخدم، وأرشفة آمنة للمستخدم مع استعادة — التقييمات التاريخية لا تُمسّ.</li>
            <li>طابور «بانتظار اعتماد المدير» في الصفحة الرئيسة: برامج جديدة، اكتمال موثق بانتظار الإقفال، وطلبات تعديل — مع اعتماد مباشر.</li>
            <li>تقارير البرامج حسب المسؤول والمجال بالأسماء لا بالأعداد فقط، وبطاقة البرنامج بزر ظاهر من صفحته وقائمته.</li>
            <li>«سجل المجالس واللجان التفصيلي»: كل عضو في صف مستقل بدوره ومهامه وحالة كل مهمة، مع بطاقة لكل لجنة.</li>
            <li>تقريرا الأداء التفصيليان (للموظف وللمدرسة) وثيقتان رسميتان مرقمتان — وتنزيلهما محصور بصلاحية الأداء الفردي.</li>
            <li>فحص المبنى يعرض إنشاء بلاغات الصيانة فور الحفظ، ويمنع البلاغ المكرر للبند المفتوح، وخطاب البلاغ اكتمل بمصدر الفحص والمبلِّغ واعتماد المدير.</li>
          </ul>
          <p className="pt-1 text-xs text-gray-500">لن يُعتبر أنك «قبِلت» التحديثات إلا بعد إرسالك ملاحظة فعلية تُسجَّل في قناة الملاحظات.</p>
        </div>
      </Card>

      <Card className="mb-5">
        <h2 className="mb-1 font-bold text-brand-900">قائمة إعادة اختبار المدير (نسخة v2.4.0)</h2>
        <p className="mb-3 text-xs text-gray-500">
          إحدى وعشرون مهمة تغطّي ملاحظات الجولة السادسة: المتبقي في الميزانية بكل مواضعه والرصيد قبل/بعد كل عملية،
          صدق المتابعة الأسبوعية ولقطات الأسابيع، تمرير القائمة الجانبية وثبات موضعها وطي أقسامها، أرشفة نماذج
          الأداء وحذف غير المستخدم منها، طابور الاعتماد في الصفحة الرئيسة، تقارير البرامج بالأسماء، بطاقة البرنامج،
          سجل المجالس واللجان التفصيلي وحالات مهام الأعضاء، تقريرا الأداء التفصيليان للموظف وللمدرسة، عرض تحويل
          ملاحظات الفحص إلى بلاغات ومنع الازدواجية، اكتمال خطاب الصيانة، وأسماء أنواع الوثائق العربية — مع التحقق
          من سلامة ما قُبل في الجولة الخامسة.
        </p>
        <RetestChecklist />
      </Card>

      {/* شريط الحالة العامة — يتبدّل حسب حالة دفعة فارس */}
      {overallReady ? (
        <Card className="mb-5 border-emerald-300 bg-emerald-50">
          <p className="text-lg font-bold text-emerald-900">التشغيل التجريبي نشط</p>
          <p className="mt-1 text-sm text-emerald-800">
            تم تفعيل بيانات المنسوبين، ووحدتا اللجان والأداء متاحتان. تابع قائمة الأسبوع الأول أدناه.
          </p>
        </Card>
      ) : (
        <Card className="mb-5 border-amber-300 bg-amber-50">
          <p className="text-lg font-bold text-amber-900">المنصة جاهزة — بانتظار إجراء تفعيل واحد من المدير</p>
          <p className="mt-2 text-sm text-amber-900">
            <span className="font-bold">بانتظار تأكيد استيراد بيانات فارس.</span> جميع الوحدات جاهزة، ويتبقى إجراء
            واحد يدوي: تأكيد استيراد دفعة فارس لإنشاء سجلات المنسوبين (٥٢ منسوباً) وفتح وحدتَي اللجان والأداء.
          </p>
          {s.fares.batchId && (
            <Link prefetch={false}
              href={`/imports/${s.fares.batchId}`}
              className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 lg:min-h-0"
            >
              فتح دفعة فارس لتأكيدها
            </Link>
          )}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* فارس */}
        {s.fares.committed ? (
          <StatusCard state="ready" title="تفعيل بيانات فارس">
            <ul className="space-y-1">
              <li>المنسوبون المفعّلون: <b className="tabular-nums">{s.fares.peopleFromBatch}</b></li>
              <li>معلمون: <b className="tabular-nums">{s.fares.teachers}</b> · موظفون: <b className="tabular-nums">{s.fares.staff}</b></li>
              <li>حسابات دخول للمنسوبين: <b className="tabular-nums">{s.fares.employeeAccounts}</b> (يجب أن تبقى صفراً)</li>
              <li>التراجع الكامل: <b>{s.fares.rollbackAvailable ? "متاح" : "غير متاح لوجود ارتباطات"}</b></li>
            </ul>
          </StatusCard>
        ) : (
          <StatusCard
            state="waiting"
            title="تفعيل بيانات فارس"
            action={s.fares.batchId ? { href: `/imports/${s.fares.batchId}`, label: "فتح دفعة فارس" } : undefined}
          >
            بانتظار تأكيد استيراد بيانات فارس (٥٢ منسوباً — ٤٢ معلماً و١٠ موظفين متوقعون). التنفيذ قرارك اليدوي.
          </StatusCard>
        )}

        {/* اللجان */}
        <StatusCard
          state={s.committeesReady ? "ready" : "waiting"}
          title="اللجان والمجالس"
          action={s.committeesReady ? { href: "/committees", label: "افتح اللجان" } : undefined}
        >
          {s.committeesReady
            ? "جاهزة لتشكيل اللجان من المنسوبين المعتمدين."
            : "بانتظار تفعيل بيانات المنسوبين — أعضاء اللجان من المنسوبين المعتمدين حصراً."}
        </StatusCard>

        {/* الأداء */}
        <StatusCard
          state={s.performanceReady ? "ready" : "waiting"}
          title="الأداء الوظيفي"
          action={s.performanceReady ? { href: "/performance", label: "افتح الأداء" } : undefined}
        >
          {s.performanceReady
            ? `جاهز لإنشاء دورات التقييم (${s.fares.teachers} معلماً و${s.fares.staff} موظفاً).`
            : "بانتظار تفعيل بيانات المنسوبين — الدورة تُنشأ لمنسوب معتمد."}
        </StatusCard>

        {/* الخطة */}
        <StatusCard
          state={s.plan.officialDraftPrograms > 0 ? "waiting" : "ready"}
          title="الخطة التشغيلية الرسمية"
          action={{ href: "/plan", label: "افتح الخطة" }}
        >
          {s.plan.total} برنامجاً رسمياً — منها <b className="tabular-nums">{s.plan.officialDraftPrograms}</b> «مسودة» بانتظار مراجعتك واعتمادها فردياً.
        </StatusCard>

        {/* D-014 */}
        <StatusCard
          state={s.d014Pending ? "waiting" : "ready"}
          title="مطابقة D-014 مع نظام فارس"
          action={{ href: "/performance/models", label: "افتح النماذج" }}
        >
          {s.d014Pending
            ? "ثلاث خلايا وزن (٥٪ في ملف النماذج مقابل ١٥٪ في الدليل) بانتظار مطابقتها مع نظام فارس عند أول دورة تقييم حقيقية."
            : "لا خلايا معلّقة."}
        </StatusCard>

        {/* الدور الأرضي */}
        <StatusCard state={s.groundPublished ? "ready" : "waiting"} title="الدور الأرضي" action={{ href: "/building", label: "افتح المبنى" }}>
          {s.groundPublished ? "منشور وقابل للاستخدام (غرف وصيانة وأصول)." : "غير منشور بعد."}
        </StatusCard>

        {/* الطوابق العليا */}
        <StatusCard
          state={s.upperFloorsPending.length > 0 ? "waiting" : "ready"}
          title="الطوابق العليا"
          action={{ href: "/building", label: "افتح المبنى" }}
        >
          {s.upperFloorsPending.length > 0
            ? `مسودات بانتظار المراجعة والنشر: ${s.upperFloorsPending.join("، ")}.`
            : "كل الطوابق منشورة."}
        </StatusCard>

        {/* النسخ الاحتياطي */}
        <StatusCard state={s.backup.latestWeekly || s.backup.latestDaily ? "ready" : "waiting"} title="النسخ الاحتياطي والاستعادة" action={{ href: "/admin/backup", label: "النسخ الاحتياطي" }}>
          <ul className="space-y-1 text-xs">
            <li>أحدث نسخة يومية: {s.backup.latestDailyAt ? fmt(s.backup.latestDailyAt) : "—"}</li>
            <li>أحدث نسخة كاملة: {s.backup.latestWeeklyAt ? fmt(s.backup.latestWeeklyAt) : "—"}</li>
            <li className="text-gray-500">بروفة الاستعادة موثّقة في سجل البروفة (docs/BACKUP_REHEARSAL_LOG.md).</li>
          </ul>
        </StatusCard>

        {/* الملاحظات */}
        <StatusCard state="info" title="ملاحظات التشغيل" action={{ href: "/admin/feedback", label: "مركز الملاحظات" }}>
          الإجمالي: <b className="tabular-nums">{s.feedback.total}</b> · مفتوحة: <b className="tabular-nums">{s.feedback.open}</b> · مُعالجة: <b className="tabular-nums">{s.feedback.resolved}</b>
          {s.feedback.blocked > 0 && <span className="text-red-700"> · تعيق العمل: {s.feedback.blocked}</span>}
        </StatusCard>

        {/* C5 والأرشفة — مؤجلة */}
        <StatusCard state="deferred" title="بوابة C5 (مؤجلة)">
          الوصول الآمن/الكاميرا/التطبيق المثبّت/العمل دون اتصال — مؤجلة بقرار مالك المنتج مع بدائل يدوية. لا إجراء مطلوب.
        </StatusCard>
        <StatusCard state="deferred" title="أرشفة السجلات التجريبية (مؤجلة)" action={{ href: "/admin/cleanup", label: "مراجعة الأرشفة" }}>
          السجلات الاصطناعية مخفية تلقائياً عن الواجهات بالمرشّح المركزي — الأرشفة الصريحة قرار يدوي مؤجّل.
        </StatusCard>
      </div>

      {/* تحذير التراجع */}
      <Card className="mt-5 border-amber-200 bg-amber-50">
        <h2 className="mb-1 font-bold text-amber-900">تنبيه مهم قبل ربط المنسوبين</h2>
        <p className="text-sm text-amber-900">
          بعد ربط الموظفين باللجان أو المهام أو دورات الأداء، قد يصبح التراجع الكامل عن استيراد فارس غير متاح. استخدم
          تصحيح أو تعطيل سجل الموظف عند الحاجة.
        </p>
      </Card>

      {/* قائمة الأسبوع الأول — إرشادية فقط، لا تنفّذ شيئاً تلقائياً */}
      <Card className="mt-5">
        <h2 className="mb-1 font-bold text-brand-900">قائمة الأسبوع الأول</h2>
        <p className="mb-3 text-sm text-gray-500">إرشادية فقط — لا تنفّذ أي إجراء تلقائياً؛ أنت من ينفّذ كل خطوة.</p>
        <ol className="list-decimal space-y-1.5 pe-6 text-sm text-gray-700">
          {CHECKLIST.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ol>
      </Card>

      {/* الحدود المعروفة — تُعرض بوضوح دون تقديمها كإخفاقات */}
      <Card className="mt-5">
        <h2 className="mb-1 font-bold text-brand-900">حدود التشغيل التجريبي المعروفة</h2>
        <p className="mb-3 text-sm text-gray-500">حدود مقبولة ومخطط لها — ليست أعطالاً.</p>
        <ul className="list-disc space-y-1.5 pe-6 text-sm text-gray-700">
          {BOUNDARIES.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

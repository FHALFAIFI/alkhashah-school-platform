"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { submitFeedbackAction, type FeedbackSubmitState } from "../feedback/actions";

/**
 * Phase 10 — لوحة إعادة اختبار المدير (عربية). لكل مهمة: رابط الصفحة، الحالة، تعليق المدير،
 * لقطة شاشة اختيارية، حفظ كمسودة (محلياً)، وإرسال ملاحظة عبر قناة الملاحظات القائمة.
 * لا يُعتبر أن المدير «قبِل» إلا بعد إرساله ملاحظة فعلية (تُسجَّل في قناة الملاحظات).
 */

// قائمة إعادة الاختبار — محدّثة لنسخة v2.4.0 (الجولة السادسة، ملاحظات ما بعد القبول):
// المتبقي في الميزانية والرصيد قبل/بعد، صدق المتابعة الأسبوعية، تمرير الشريط الجانبي
// وثبات موضعه، أرشفة/حذف نماذج الأداء، طابور الاعتماد في الصفحة الرئيسة، تقارير البرامج
// بالأسماء، سجل المجالس واللجان التفصيلي، تقريرا الأداء التفصيليان، عرض تحويل ملاحظات
// الفحص إلى بلاغات ومنع الازدواجية، وخطاب الصيانة المكتمل.
const TASKS: { id: string; text: string; href: string }[] = [
  { id: "t1", text: "في الميزانية: تحقق أن «المتبقي» ظاهر في البطاقات العليا وجدول البنود وبطاقات البنود، وأن بطاقتي «بنود قاربت الاستنفاد» و«عمليات بلا مبلغ مُدخل» ظهرتا في الملخص", href: "/budget" },
  { id: "t2", text: "افتح تفصيل بند له مخصص: دفتر العمليات يعرض «المتبقي قبل العملية» و«المتبقي بعد العملية» لكل مصروف إضافة إلى الرصيد النقدي الجاري", href: "/budget" },
  { id: "t3", text: "أثناء إضافة مصروف على بند له مخصص: يظهر «المتبقي بعد الحفظ» مباشرة أثناء كتابة المبلغ، وإن كان سيتجاوز المخصص يظهر تنبيه بالمقدار دون منع الحفظ", href: "/budget" },
  { id: "t4", text: "نزّل تقرير «سجل المصروفات» وتحقق من عمود «متبقي البند بعد العملية» لكل صف", href: "/reports?category=finance&report=expense-register" },
  { id: "t5", text: "افتح «المتابعة الأسبوعية»: البرامج مجمعة بصدق (متأخر/بلا تحديث هذا الأسبوع/في المسار/مكتمل بانتظار الإقفال/مغلق) — البرنامج غير المحدث يحمل وسم «لم يتم التحديث هذا الأسبوع» ولا يظهر «مكتملاً»، وجرّب اختيار أسبوع سابق لعرض لقطته التاريخية", href: "/plan/followup" },
  { id: "t6", text: "سجّل متابعة أسبوعية واترك حقل النسبة فارغاً: تقدم البرنامج يبقى كما هو ولا يتصفر", href: "/plan/followup" },
  { id: "t7", text: "مرّر داخل القائمة الجانبية والمؤشر فوقها مباشرة، وانتقل لصفحة ثم عد: موضع التمرير محفوظ ولا يقفز للأعلى، وجرّب طي قسم وفتحه وحدّث الصفحة — الحالة تُتذكّر", href: "/dashboard" },
  { id: "t8", text: "في «نماذج الأداء»: أنشئ نموذجاً تجريبياً غير مستخدم واحذفه نهائياً (بعد التأكيد)، ثم أرشف نموذجاً مستخدماً — يختفي من اختيار الدورات الجديدة ويبقى في «النماذج المؤرشفة» مع إمكانية الاستعادة، وتقاريره التاريخية تعمل", href: "/performance/models" },
  { id: "t9", text: "في الصفحة الرئيسة: قسم «بانتظار اعتماد المدير» بقوائمه الثلاث (برامج جديدة / اكتمال موثق بانتظار الإقفال / طلبات تعديل) — واعتمد برنامجاً مسودة من الصفحة الرئيسة مباشرة", href: "/dashboard" },
  { id: "t10", text: "افتح تقرير «البرامج حسب المسؤول» و«البرامج حسب المجال»: أسماء البرامج ظاهرة صفاً صفاً مع الحالة والتقدم والتواريخ والشواهد — والملخص الرقمي ما زال متاحاً بتقرير مستقل", href: "/reports?category=plan&report=programs-by-owner" },
  { id: "t11", text: "من صفحة برنامج اضغط «طباعة بطاقة البرنامج والتقرير» وأصدر التقرير: فيه الرقم التسلسلي واعتماد المدير ودورة الحياة (الاكتمال الموثق منفصل عن الإقفال)", href: "/plan" },
  { id: "t12", text: "من «اللجان والمجالس» أصدر «السجل التفصيلي (PDF)»: قسم لكل لجنة، وكل عضو في صف مستقل بدوره ومهامه وحالة كل مهمة — وحدّد حالة مهمة (لم تبدأ/قيد التنفيذ/منجزة) من صفحة اللجنة أولاً", href: "/committees" },
  { id: "t13", text: "افتح صفحة الأداء التفصيلية لموظف: اختر دورة/سنة، وراجع الدرجة الموزونة والملاحظة والشواهد لكل معيار وسجل الجلسات باعتمادها — ثم أصدر «التقرير التفصيلي (PDF)»", href: "/performance/analytics" },
  { id: "t14", text: "من «لوحة الأداء العام» أصدر «تقرير المدرسة التفصيلي (PDF)»: مؤشرات المدرسة كاملة مع ملحق أسماء الموظفين المقيَّمين", href: "/performance/analytics" },
  { id: "t15", text: "نفّذ فحصاً فيه بنود «يحتاج معالجة»: يظهر فوراً «تم تسجيل N ملاحظات — هل تريد إنشاء بلاغات الصيانة الآن؟» — جرّب «إنشاء بلاغات لكل الملاحظات»", href: "/building/inspections" },
  { id: "t16", text: "أعد فحص نفس الغرفة بنفس البند الفاشل وحاول تحويل الملاحظة الجديدة: يُمنع الإنشاء المكرر ويُشار إلى رقم البلاغ المفتوح القائم", href: "/building/inspections" },
  { id: "t17", text: "افتح بلاغاً في حالة «مسودة»: الصفحة تشرح أن الخطاب يتاح بعد الاعتماد، وزر «اعتماد البلاغ وإصدار التقرير» ينفذهما بخطوة واحدة ثم يظهر «تنزيل PDF» و«طباعة تقرير الصيانة»", href: "/building/maintenance" },
  { id: "t18", text: "افتح خطاب بلاغ مصدره فحص: فيه مصدر الفحص وأثر السلامة والمبلِّغ واعتماد المدير، و«الإجراء المطلوب» ثابت منفصل عن «الإجراء المتخذ»", href: "/building/maintenance" },
  { id: "t19", text: "على صف ملاحظة الفحص تظهر حالة البلاغ المرتبط مباشرة، وصفحة البلاغ تعرض هوية الفحص المصدر كاملة، وقائمة البلاغات فيها عمود «المصدر»", href: "/building/maintenance" },
  { id: "t20", text: "في «الوثائق الصادرة»: أنواع الوثائق كلها بأسماء عربية (لا مفاتيح إنجليزية) — وجرّب تنزيل Word لأي تقرير: الترويسة الرسمية فيه", href: "/documents" },
  { id: "t21", text: "تحقق أن ما قبلته في v2.3 ما زال يعمل: الدورة الكاملة لبلاغ الصيانة، التقويم المزدوج، اعتماد الملفات، الهوية المركزية في الوثائق، وتحليلات الأداء", href: "/pilot" },
];

const STATUSES = ["لم أبدأ", "نجح", "واجهت مشكلة"] as const;
type Status = (typeof STATUSES)[number];
// v3 — مفتاح جديد حتى لا تُسقَط حالات مسودة v2.3 القديمة على مهام v2.4 المختلفة
const DRAFT_KEY = "madrasa-retest-draft-v3";

type Row = { status: Status; comment: string };
type Draft = Record<string, Row>;

export function RetestChecklist() {
  const [draft, setDraft] = useState<Draft>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      // قراءة المسودة المحفوظة محلياً عند التركيب (قيمة العميل فقط)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setDraft(JSON.parse(raw));
    } catch {
      // تجاهل مسودة تالفة
    }
  }, []);

  function update(id: string, patch: Partial<Row>) {
    setDraft((d) => ({ ...d, [id]: { status: d[id]?.status ?? "لم أبدأ", comment: d[id]?.comment ?? "", ...patch } }));
    setSaved(false);
  }
  function saveDraft() {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    setSaved(true);
  }

  const done = Object.values(draft).filter((r) => r.status === "نجح").length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-600">أنجز المهام التالية بالترتيب ثم أرسل ملاحظة عن كل مهمة. الملاحظة تصل إلى قناة الملاحظات مباشرة.</p>
        <span className="rounded-full bg-brand-50 px-3 py-1 text-sm text-brand-900">نجح: {done} / {TASKS.length}</span>
      </div>

      <ol className="space-y-2">
        {TASKS.map((task, i) => (
          <RetestItem key={task.id} index={i + 1} task={task} row={draft[task.id]} onChange={(p) => update(task.id, p)} />
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={saveDraft} className="rounded-lg border border-sand-200 bg-white px-4 py-2 text-sm font-medium text-gray-700">
          حفظ كمسودة
        </button>
        {saved && <span role="status" className="text-sm text-emerald-700">حُفظت المسودة على هذا الجهاز</span>}
      </div>
    </div>
  );
}

function RetestItem({
  index,
  task,
  row,
  onChange,
}: {
  index: number;
  task: { id: string; text: string; href: string };
  row?: Row;
  onChange: (p: Partial<Row>) => void;
}) {
  const [pending, start] = useTransition();
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const status = row?.status ?? "لم أبدأ";
  const comment = row?.comment ?? "";

  function submit() {
    setError(null);
    const problem = status === "واجهت مشكلة";
    const fd = new FormData();
    fd.set("pagePath", task.href);
    fd.set("module", "إعادة الاختبار التجريبي");
    fd.set("category", problem ? "مشكلة" : "اقتراح");
    fd.set("severity", problem ? "تؤثر جزئياً على العمل" : "ملاحظة بسيطة");
    fd.set("title", `إعادة اختبار ${index}: ${status} — ${task.text}`.slice(0, 200));
    fd.set("attempted", comment || task.text);
    const file = fileRef.current?.files?.[0];
    if (file) fd.set("attachment", file);
    start(async () => {
      const res: FeedbackSubmitState = await submitFeedbackAction(fd);
      if (res.error) setError(res.error);
      else if (res.ok && res.ref) {
        setSent(res.ref);
        if (fileRef.current) fileRef.current.value = "";
      }
    });
  }

  return (
    <li className="rounded-xl border border-sand-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="font-medium text-gray-800">{index}. {task.text}</span>
          <Link href={task.href} className="ms-2 text-sm text-brand-700 underline">افتح الصفحة</Link>
        </div>
        <select value={status} onChange={(e) => onChange({ status: e.target.value as Status })} className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm">
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <textarea
        value={comment}
        onChange={(e) => onChange({ comment: e.target.value })}
        rows={2}
        placeholder="تعليق المدير (اختياري)"
        className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept="image/*" className="text-xs" aria-label="لقطة شاشة اختيارية" />
        <button type="button" onClick={submit} disabled={pending} className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "جارٍ الإرسال…" : "إرسال ملاحظة"}
        </button>
        {sent && <span role="status" className="text-xs text-emerald-700">تم تسجيل ملاحظتك — الرقم المرجعي {sent}</span>}
        {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
      </div>
    </li>
  );
}

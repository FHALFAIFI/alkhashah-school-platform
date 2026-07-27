"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { submitFeedbackAction, type FeedbackSubmitState } from "../feedback/actions";

/**
 * Phase 10 — لوحة إعادة اختبار المدير (عربية). لكل مهمة: رابط الصفحة، الحالة، تعليق المدير،
 * لقطة شاشة اختيارية، حفظ كمسودة (محلياً)، وإرسال ملاحظة عبر قناة الملاحظات القائمة.
 * لا يُعتبر أن المدير «قبِل» إلا بعد إرساله ملاحظة فعلية (تُسجَّل في قناة الملاحظات).
 */

// قائمة إعادة الاختبار — محدّثة لتصحيحات النسخة v2.1 (حذف البرامج والتصنيفات، رقم الفاتورة وإرفاقها،
// «البند»، المتبقي التلقائي، زر العودة، «التوصيات»، الإقفال دون شواهد، قائمتا أعضاء/مهام اللجنة،
// محضر بلا «الصفة» ومع «التوقيع» وبلا «النتائج/الأثر»، واختيارية كل الحقول.)
const TASKS: { id: string; text: string; href: string }[] = [
  { id: "t1", text: "افتح برنامجاً وحدّث «نسبة الإنجاز» و«حالة التنفيذ» مباشرةً (لا أنشطة فرعية ولا جاهزية إقفال)", href: "/plan" },
  { id: "t2", text: "احذف/أرشف برنامجاً تجريبياً: اضغط «أرشفة البرنامج»، وتحقق من ظهور رسالة تأكيد عربية تذكر اسم البرنامج، ثم أعد استرجاعه بزر «استرجاع» — لا تُفقد أي سجلات", href: "/plan" },
  { id: "t3", text: "افتح «إدارة التصنيفات»، وأعد تسمية تصنيف أو احذفه بإعادة إسناد برامجه إلى تصنيف آخر — لا يُحذف أي برنامج", href: "/plan/classifications" },
  { id: "t4", text: "ارفع شاهداً واحداً لبرنامج ولاحظ تحديث عدّاد الشواهد فوراً دون إعادة تحميل الصفحة، والشواهد اختيارية (بلا نسبة أو نواقص)", href: "/plan" },
  { id: "t5", text: "افتح الميزانية وسجّل إيراداً، ثم اضغط «الإيصال» في صفّه وارفع إيصالاً مباشرةً أو اربط شاهداً قائماً — الإيصال اختياري", href: "/budget" },
  { id: "t6", text: "سجّل مصروفاً: «البند» قائمة (المستلزمات/النشاط)، والحقل يسمّى «رقم الفاتورة» (لا «مرجع الدفع»)، وأرفق الفاتورة اختيارياً (صورة أو PDF)", href: "/budget" },
  { id: "t7", text: "اربط المصروف ببرنامج له ميزانية معتمدة، وتحقق من ظهور «الميزانية المعتمدة» و«المصروف» و«المتبقي» تلقائياً (وحالة محايدة إن لا ميزانية)", href: "/budget" },
  { id: "t8", text: "من صفحة جلسة الأداء أو صفحة البرنامج، جرّب زر «العودة» وتأكد أنه يرجع للصفحة السابقة ذات المعنى (لا للرئيسية دائماً)", href: "/performance" },
  { id: "t9", text: "في جلسة التقييم تحقق أن الحقل يسمّى «التوصيات» (لا «الإجراءات»)", href: "/performance" },
  { id: "t10", text: "أقفل/أنهِ تقييماً نهائياً دون رفع أي شاهد وتحقق أن الإقفال يتم — الشواهد غير إلزامية إطلاقاً", href: "/performance" },
  { id: "t11", text: "افتح دورة فيها جلسة تخطيط فقط وتحقق أنها تعرض «لم يبدأ التقييم بعد» لا 0٪ («تخطيط — لا يُحتسب»)", href: "/performance" },
  { id: "t12", text: "افتح لجنة، حمّل مهامها المعرّفة مسبقاً، وزّعها، ثم ولّد نموذج التكليف: تحقق أنه قائمتان مستقلتان «أعضاء اللجنة» (كل الأعضاء ولو بلا مهمة) و«مهام اللجنة» (كل المهام ولو بلا عضو)", href: "/committees" },
  { id: "t13", text: "أنشئ محضر اجتماع: تحقق أن جدول الحضور بلا حقل «الصفة» وفيه عمود «التوقيع» بجوار «العمل في اللجنة»، وأنه لا توجد حقول «النتائج» و«الأثر»، والحفظ لا يُمنع", href: "/committees" },
  { id: "t14", text: "احفظ نموذجاً واحداً مع ترك كل الحقول فارغة (بلا عنوان مثلاً) وتحقق أن الحفظ ينجح دون رسالة «مطلوب» ودون خطأ", href: "/committees" },
  { id: "t15", text: "أصدر تقرير برنامج وتحقق أنه يركّز على المعلومات والتقدم المباشر والشواهد وعددها والميزانية — بلا أنشطة أو جاهزية إقفال أو نواقص شواهد", href: "/plan" },
  { id: "t16", text: "اختبار الاستقرار: افتح نموذجاً واضغط «حفظ» مرتين بسرعة، وافتح/أغلق حواراً، وارفع ملفاً — تأكد ألا يظهر خطأ إنجليزي ولا تتكرر العملية", href: "/committees" },
  { id: "t17", text: "أرسل ملاحظة تشغيل واحدة عبر «إرسال ملاحظة»", href: "/dashboard" },
];

const STATUSES = ["لم أبدأ", "نجح", "واجهت مشكلة"] as const;
type Status = (typeof STATUSES)[number];
const DRAFT_KEY = "madrasa-retest-draft-v1";

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

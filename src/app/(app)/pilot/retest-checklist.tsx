"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { submitFeedbackAction, type FeedbackSubmitState } from "../feedback/actions";

/**
 * Phase 10 — لوحة إعادة اختبار المدير (عربية). لكل مهمة: رابط الصفحة، الحالة، تعليق المدير،
 * لقطة شاشة اختيارية، حفظ كمسودة (محلياً)، وإرسال ملاحظة عبر قناة الملاحظات القائمة.
 * لا يُعتبر أن المدير «قبِل» إلا بعد إرساله ملاحظة فعلية (تُسجَّل في قناة الملاحظات).
 */

const TASKS: { id: string; text: string; href: string }[] = [
  { id: "t1", text: "افتح سجل المنسوبين وراجع منسوباً واحداً (النوع: معلم/موظف إداري)", href: "/people" },
  { id: "t2", text: "افتح برنامجاً وحدّث «نسبة الإنجاز» و«حالة التنفيذ» مباشرةً على البرنامج — لاحظ أنه لا توجد أنشطة فرعية", href: "/plan" },
  { id: "t3", text: "افتح المتابعة الأسبوعية وسجّل متابعة لبرنامج معتمد مع إدخال نسبة إنجاز مباشرة", href: "/plan/followup" },
  { id: "t4", text: "راجع سطر «الشواهد» في المتابعة: لاحظ الحالة الفعلية (لم يُرفع أي شاهد / شاهد واحد / عدة شواهد) دون أي نسبة أو «متبقٍّ»، وافتح شواهد البرنامج", href: "/plan/followup" },
  { id: "t5", text: "ارفع شاهداً واحداً لبرنامج ثم أعد فتح المتابعة ولاحظ تغيّر العبارة وأحدث تاريخ رفع", href: "/plan" },
  { id: "t6", text: "افتح الميزانية وسجّل إيراداً، ثم اضغط «الإيصال» في صف السجل وارفع إيصالاً مباشرةً أو اربط شاهداً قائماً", href: "/budget" },
  { id: "t7", text: "سجّل مصروفاً وتحقق أن حقل الوصف يسمى «البند» (لا «المستلزمات») ثم ارفع إيصاله — الإيصال اختياري وليس شرطاً", href: "/budget" },
  { id: "t8", text: "افتح دورة أداء فيها جلسة تخطيط فقط، وتحقق أن نتيجة الدورة تعرض «لم يبدأ التقييم بعد» لا 0٪", href: "/performance" },
  { id: "t9", text: "سجّل جلسة تقييم فعلية، ولاحظ أن نتيجة الدورة تُحسب دون احتساب جلسة التخطيط (تظهر «تخطيط — لا يُحتسب»)", href: "/performance" },
  { id: "t10", text: "افتح لجنة، اختر نوعها وحمّل مهامها المعرّفة مسبقاً (راجعها كقيم ابتدائية قابلة للتعديل — ليست قائمة معتمدة رسمياً)، ثم عدّل/استبعد/رتّب المهام ووزّعها على الأعضاء", href: "/committees" },
  { id: "t11", text: "ولّد جدول توزيع المهام واطبعه، وتحقق من وجود عمود «توقيع العضو» في الجدول", href: "/committees" },
  { id: "t12", text: "أنشئ محضر اجتماع أو تقريراً من نوع لا يتطلب توقيعاً، وتحقق أنه لا يُفرض رفع توقيع لإكماله", href: "/committees" },
  { id: "t13", text: "أصدر تقرير برنامج واحد وتحقق أنه يركّز على المعلومات والتقدم المباشر والشواهد المرفوعة وعددها والميزانية والنتائج — بلا أنشطة أو جاهزية إقفال أو نواقص شواهد", href: "/plan" },
  { id: "t14", text: "اختبار الاستقرار: افتح نموذجاً واضغط «حفظ» مرتين بسرعة، وافتح/أغلق حواراً، وارفع ملفاً — تأكد ألا يظهر خطأ إنجليزي ولا تتكرر العملية", href: "/committees" },
  { id: "t15", text: "أرسل ملاحظة تشغيل واحدة عبر «إرسال ملاحظة»", href: "/dashboard" },
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

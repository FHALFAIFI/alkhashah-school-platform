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
  { id: "t2", text: "افتح برنامجاً وأضف نشاطاً واحداً بمسؤول وموعد", href: "/plan" },
  { id: "t3", text: "حدّث نسبة إنجاز النشاط ولاحظ تغيّر تقدم البرنامج (من الأنشطة)", href: "/plan" },
  { id: "t4", text: "راجع لوحة «جاهزية الإقفال» والنواقص، وجرّب أن الإقفال محجوب حتى تكتمل الجاهزية", href: "/plan" },
  { id: "t5", text: "افتح دورة أداء، وسجّل جلسة، وارفع تقريرها الموقّع (لاحظ تمييز اكتمال التقييم عن استلام التوقيع)", href: "/performance" },
  { id: "t6", text: "افتح لجنة معتمدة، ولّد نموذج التكليف واطبعه، ثم ارفع الأصل الموقّع", href: "/committees" },
  { id: "t7", text: "اضبط هوية الوثائق (الترويسة والتواقيع) من الإعدادات، وأصدر وثيقة ولاحظ ثبات لقطتها", href: "/admin/settings" },
  { id: "t8", text: "افتح قائمة المرافق: علّم مرفقاً «موجود» واربطه بغرفة فعلية", href: "/building/facilities" },
  { id: "t9", text: "افتح غرفة واحدة وراجع بياناتها وأصولها المهمة", href: "/building" },
  { id: "t10", text: "أنشئ أصلاً مهماً ثم أرشفه واستعده", href: "/building/assets" },
  { id: "t11", text: "افتح الميزانية وسجّل إيراداً واحداً", href: "/budget" },
  { id: "t12", text: "سجّل مصروفاً مرتبطاً ببرنامج، واربط إيصاله من سجل الشواهد (بلا رفع مكرر)", href: "/budget" },
  { id: "t13", text: "أصدر تقرير برنامج واحد (يشمل الأنشطة والجاهزية والميزانية) وراجعه", href: "/plan" },
  { id: "t14", text: "أصدر التقرير التنفيذي الشامل من مركز التقارير", href: "/reports" },
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

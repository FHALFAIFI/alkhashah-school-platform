"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SubmitButton } from "@/components/ui";
import {
  RESPONSE_TYPE_LABELS,
  SEVERITY_LEVELS,
  type TemplateResponseType,
  type TemplateSection,
  type TemplateItem,
} from "@/lib/building/inspection-template-defs";
import type { TemplateActionState } from "../../template-actions";
import { useRefreshOnSuccess } from "@/components/form-reset";

type Meta = { nameAr: string; roomType: string; purpose: string; instructions: string };

function newKey() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : String(Date.now());
}

function blankItem(): TemplateItem {
  return { key: newKey(), label: "", required: true, responseType: "compliant" };
}

export function TemplateEditor({
  action,
  initialMeta,
  initialSections,
  submitLabel,
  currentId,
}: {
  action: (prev: TemplateActionState, fd: FormData) => Promise<TemplateActionState>;
  initialMeta: Meta;
  initialSections: TemplateSection[];
  submitLabel: string;
  currentId?: string;
}) {
  const [state, formAction] = useActionState<TemplateActionState, FormData>(action, null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);
  const router = useRouter();

  // على النجاح انتقل إلى صفحة القالب (الإصدار الجديد إن وُجد، وإلا القالب الحالي)
  useEffect(() => {
    const target = state?.newId ?? currentId;
    if (state?.success && target) {
      router.push(`/building/inspections/templates/${target}`);
      router.refresh();
    }
  }, [state, currentId, router]);
  const [meta, setMeta] = useState<Meta>(initialMeta);
  const [sections, setSections] = useState<TemplateSection[]>(
    initialSections.length > 0 ? initialSections : [{ key: newKey(), title: "قسم ١", items: [blankItem()] }],
  );

  const setSection = (i: number, patch: Partial<TemplateSection>) =>
    setSections((s) => s.map((sec, idx) => (idx === i ? { ...sec, ...patch } : sec)));
  const setItem = (si: number, ii: number, patch: Partial<TemplateItem>) =>
    setSections((s) =>
      s.map((sec, idx) =>
        idx === si ? { ...sec, items: sec.items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) } : sec,
      ),
    );
  const move = <T,>(arr: T[], from: number, to: number): T[] => {
    if (to < 0 || to >= arr.length) return arr;
    const copy = [...arr];
    const [x] = copy.splice(from, 1);
    copy.splice(to, 0, x);
    return copy;
  };

  return (
    <form action={formAction} className="space-y-5">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-sm text-emerald-700">{state.success}</div>}

      <input type="hidden" name="sectionsJson" value={JSON.stringify(sections)} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">اسم القالب</span>
          <input name="nameAr" value={meta.nameAr} onChange={(e) => setMeta({ ...meta, nameAr: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">نوع الغرفة (اختياري)</span>
          <input name="roomType" value={meta.roomType} onChange={(e) => setMeta({ ...meta, roomType: e.target.value })} placeholder="مثال: مختبر، دورة مياه…" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">غرض الفحص (اختياري)</span>
          <input name="purpose" value={meta.purpose} onChange={(e) => setMeta({ ...meta, purpose: e.target.value })} placeholder="السلامة، النظافة، الجاهزية…" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">تعليمات عامة (اختياري)</span>
          <input name="instructions" value={meta.instructions} onChange={(e) => setMeta({ ...meta, instructions: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </label>
      </div>

      <div className="space-y-4">
        {sections.map((sec, si) => (
          <div key={sec.key} className="rounded-xl border border-sand-200 bg-white p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <input
                value={sec.title}
                onChange={(e) => setSection(si, { title: e.target.value })}
                placeholder="عنوان القسم"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold"
              />
              <button type="button" onClick={() => setSections((s) => move(s, si, si - 1))} className="rounded border px-2 py-1 text-xs" aria-label="أعلى">▲</button>
              <button type="button" onClick={() => setSections((s) => move(s, si, si + 1))} className="rounded border px-2 py-1 text-xs" aria-label="أسفل">▼</button>
              <button type="button" onClick={() => setSections((s) => s.filter((_, i) => i !== si))} className="rounded border border-red-300 px-2 py-1 text-xs text-red-700">حذف القسم</button>
            </div>

            <div className="space-y-2">
              {sec.items.map((it, ii) => (
                <div key={it.key} className="rounded-lg border border-sand-100 bg-sand-50 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={it.label}
                      onChange={(e) => setItem(si, ii, { label: e.target.value })}
                      placeholder="وصف عنصر الفحص"
                      className="min-w-48 flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                    <select
                      value={it.responseType}
                      onChange={(e) => setItem(si, ii, { responseType: e.target.value as TemplateResponseType })}
                      className="rounded border border-gray-300 px-2 py-1 text-xs"
                      aria-label="نوع الإجابة"
                    >
                      {(Object.keys(RESPONSE_TYPE_LABELS) as TemplateResponseType[]).map((rt) => (
                        <option key={rt} value={rt}>{RESPONSE_TYPE_LABELS[rt]}</option>
                      ))}
                    </select>
                    <button type="button" onClick={() => setSection(si, { items: move(sec.items, ii, ii - 1) })} className="rounded border px-2 py-0.5 text-xs" aria-label="أعلى">▲</button>
                    <button type="button" onClick={() => setSection(si, { items: move(sec.items, ii, ii + 1) })} className="rounded border px-2 py-0.5 text-xs" aria-label="أسفل">▼</button>
                    <button type="button" onClick={() => setSection(si, { items: sec.items.filter((_, j) => j !== ii) })} className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-700">حذف</button>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-600">
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={it.required} onChange={(e) => setItem(si, ii, { required: e.target.checked })} /> إلزامي
                    </label>
                    <label className="flex items-center gap-1">
                      الخطورة عند الإخفاق:
                      <select value={it.severityOnFail ?? ""} onChange={(e) => setItem(si, ii, { severityOnFail: (e.target.value || undefined) as TemplateItem["severityOnFail"] })} className="rounded border border-gray-300 px-1 py-0.5">
                        <option value="">—</option>
                        {SEVERITY_LEVELS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={!!it.correctiveActionRequired} onChange={(e) => setItem(si, ii, { correctiveActionRequired: e.target.checked })} /> يتطلب إجراءً تصحيحياً عند الإخفاق
                    </label>
                    {it.responseType === "rating" && (
                      <label className="flex items-center gap-1">
                        أقصى تقدير:
                        <input type="number" min={2} max={10} value={it.ratingMax ?? 5} onChange={(e) => setItem(si, ii, { ratingMax: Number(e.target.value) })} className="w-14 rounded border border-gray-300 px-1 py-0.5" />
                      </label>
                    )}
                  </div>
                  <input
                    value={it.instructions ?? ""}
                    onChange={(e) => setItem(si, ii, { instructions: e.target.value || undefined })}
                    placeholder="تعليمات للعنصر (اختياري)"
                    className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs"
                  />
                </div>
              ))}
              <button type="button" onClick={() => setSection(si, { items: [...sec.items, blankItem()] })} className="rounded-lg border border-brand-300 px-3 py-1 text-xs font-medium text-brand-800">
                + إضافة عنصر
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setSections((s) => [...s, { key: newKey(), title: `قسم ${s.length + 1}`, items: [blankItem()] }])}
          className="rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-800"
        >
          + إضافة قسم
        </button>
      </div>

      <SubmitButton>{submitLabel}</SubmitButton>
    </form>
  );
}

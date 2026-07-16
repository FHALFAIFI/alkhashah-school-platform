"use client";

import { useActionState, useMemo, useState } from "react";
import { createCycleAction, type ActionState } from "./actions";
import { Field, SubmitButton } from "@/components/ui";

export function NewCycleForm({
  people,
  models,
}: {
  people: { id: string; fullName: string; category: string; suggestedModelKey: string | null }[];
  models: { id: string; nameAr: string; audience: string; official: boolean }[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(createCycleAction, null);
  const [personId, setPersonId] = useState("");
  const person = useMemo(() => people.find((p) => p.id === personId), [people, personId]);
  const cycleType = person?.category === "موظف" ? "موظف" : "معلم";
  // D-014: عند غياب نموذج معتمد مطابق للفئة (كل النماذج الرسمية «معلم» مثلاً) تعرض جميع
  // النماذج المعتمدة للاختيار اليدوي مع تحذير — الخادم يسمح بعدم التطابق في هذه الحالة فقط.
  const matchingModels = models.filter((m) => m.audience === cycleType);
  const noMatchingModel = matchingModels.length === 0;
  const availableModels = noMatchingModel ? models : matchingModels;

  return (
    <form action={formAction} className="space-y-3">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{state.error}</div>}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label className="mb-1 block text-sm font-medium text-gray-700">الشخص</label>
          <select
            name="personId"
            required
            value={personId}
            onChange={(e) => setPersonId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">— اختر —</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.fullName} ({p.category})</option>
            ))}
          </select>
        </div>
        <input type="hidden" name="cycleType" value={cycleType} />
        <div className="min-w-56 flex-1">
          <label className="mb-1 block text-sm font-medium text-gray-700">نموذج الأداء (يتطلب تأكيدك)</label>
          <select name="modelId" required className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="">— اختر —</option>
            {availableModels.map((m) => (
              <option key={m.id} value={m.id}>{m.nameAr}{m.official ? " (رسمي)" : ""}{m.audience !== cycleType ? ` — لفئة «${m.audience}»` : ""}</option>
            ))}
          </select>
          {noMatchingModel && (
            <p role="alert" className="mt-1 rounded bg-amber-50 p-2 text-xs text-amber-900">
              لا يوجد نموذج رسمي لهذه الفئة — الاختيار اليدوي مسؤوليتك (لا يُخترع نموذج)
            </p>
          )}
          {person?.suggestedModelKey && (
            <p className="mt-1 text-xs text-purple-700">اقتراح آلي من المسمى الوظيفي: {person.suggestedModelKey} — الاختيار النهائي لك</p>
          )}
        </div>
        <div className="w-36">
          <Field label={cycleType === "معلم" ? "السنة الدراسية" : "السنة الميلادية"} name="yearKey" defaultValue={cycleType === "معلم" ? "1448-1449" : "2026"} required dir="ltr" />
        </div>
      </div>
      {cycleType === "موظف" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="موعد التخطيط" name="planningDeadline" type="date" />
          <Field label="موعد مراجعة المنتصف" name="midDeadline" type="date" />
          <Field label="موعد التقييم النهائي" name="finalDeadline" type="date" />
        </div>
      )}
      {cycleType === "معلم" && (
        <p className="text-xs text-gray-400">
          دورة المعلم ترتكز على التقويم الدراسي المعتمد وتبدأ بحدث «عودة المعلمين» — تجمد لقطة التقويم عند الإنشاء.
        </p>
      )}
      <SubmitButton>إنشاء الدورة</SubmitButton>
    </form>
  );
}

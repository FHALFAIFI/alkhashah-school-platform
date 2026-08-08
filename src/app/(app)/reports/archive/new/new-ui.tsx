"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/ui";
import { useRefreshOnSuccess } from "@/components/form-reset";
import { createInstanceAction } from "../actions";

/**
 * نموذج إنشاء تقرير محفوظ جديد (v2.6 §A).
 *
 * النوع المفرد يطلب اختيار التقرير المصدر؛ الأنواع المركّبة أقسامها معلَنة في سجلّها.
 * الإنشاء يحوّل مباشرة إلى صفحة المسودة حيث المعاينة الحية والمرشّحات.
 */
export function NewInstanceForm({
  types,
  reportChoices,
  templates,
}: {
  types: { key: string; label: string; description: string; sectionLabels: string[] }[];
  reportChoices: { key: string; label: string; category: string }[];
  templates: { key: string; label: string }[];
}) {
  const [state, formAction] = useActionState(createInstanceAction, null);
  useRefreshOnSuccess(state);
  const [typeKey, setTypeKey] = useState(types[0]?.key ?? "single");
  const selectedType = types.find((t) => t.key === typeKey);

  const byCategory = new Map<string, { key: string; label: string }[]>();
  for (const r of reportChoices) {
    const list = byCategory.get(r.category) ?? [];
    list.push(r);
    byCategory.set(r.category, list);
  }

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-medium text-gray-700">نوع التقرير</p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {types.map((t) => (
            <label
              key={t.key}
              className={`cursor-pointer rounded-xl border p-3 text-sm ${
                typeKey === t.key ? "border-brand-600 bg-brand-50" : "border-sand-200 bg-white hover:bg-sand-50"
              }`}
            >
              <input
                type="radio"
                name="typeKey"
                value={t.key}
                checked={typeKey === t.key}
                onChange={() => setTypeKey(t.key)}
                className="ms-0 me-2"
              />
              <span className="font-bold text-brand-900">{t.label}</span>
              <p className="mt-1 text-xs text-gray-500">{t.description}</p>
              {t.sectionLabels.length > 0 && (
                <p className="mt-1 text-xs text-gray-400">الأقسام: {t.sectionLabels.join("، ")}</p>
              )}
            </label>
          ))}
        </div>
      </div>

      {typeKey === "single" && (
        <div>
          <label htmlFor="reportKey" className="mb-1 block text-sm font-medium text-gray-700">
            التقرير المصدر
          </label>
          <select
            id="reportKey"
            name="reportKey"
            required
            className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0"
          >
            {[...byCategory.entries()].map(([category, reports]) => (
              <optgroup key={category} label={category}>
                {reports.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="title" className="mb-1 block text-sm font-medium text-gray-700">
            عنوان التقرير الكامل
          </label>
          <input
            id="title"
            name="title"
            maxLength={200}
            placeholder={selectedType ? selectedType.label : ""}
            className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm lg:min-h-0"
          />
          <p className="mt-1 text-xs text-gray-400">فارغاً يأخذ اسم النوع — وهو ما يظهر في اسم الملف المولَّد</p>
        </div>
        <div>
          <label htmlFor="templateKey" className="mb-1 block text-sm font-medium text-gray-700">
            القالب
          </label>
          <select
            id="templateKey"
            name="templateKey"
            className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0"
          >
            <option value="">قالب النوع الافتراضي</option>
            {templates.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="periodFrom" className="mb-1 block text-sm font-medium text-gray-700">
            الفترة من
          </label>
          <input id="periodFrom" name="periodFrom" type="date" className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm lg:min-h-0" />
        </div>
        <div>
          <label htmlFor="periodTo" className="mb-1 block text-sm font-medium text-gray-700">
            الفترة إلى
          </label>
          <input id="periodTo" name="periodTo" type="date" className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm lg:min-h-0" />
        </div>
      </div>

      <SubmitButton>إنشاء المسودة</SubmitButton>
      {state?.error ? <p className="rounded-lg bg-red-50 p-2 text-xs text-red-800">{state.error}</p> : null}
    </form>
  );
}

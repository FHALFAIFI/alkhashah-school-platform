"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { ReportDefinition } from "@/lib/reports/catalog";

/**
 * شريط مرشّحات التقرير (v2.2 §D10).
 *
 * المرشّحات تُخزَّن في عنوان URL وحده، فيصبح كل عرض قابلاً للمشاركة كرابط عميق ويعمل زر
 * الرجوع في المتصفّح طبيعياً. لا يُعرض إلا المرشّح الذي أعلنه التقرير في السجل.
 */
export function ReportFilterBar({
  report,
  statusOptions,
  itemOptions,
  personOptions,
}: {
  report: ReportDefinition;
  statusOptions: string[];
  itemOptions: { id: string; label: string }[];
  personOptions: { id: string; label: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, setPending] = useState(false);

  const filters = report.filters ?? [];
  if (filters.length === 0) return null;

  const current = (key: string) => params.get(key) ?? "";

  function apply(form: FormData) {
    setPending(true);
    const sp = new URLSearchParams();
    sp.set("category", report.category);
    sp.set("report", report.key);
    for (const [k, v] of form.entries()) {
      const value = String(v).trim();
      if (value) sp.set(k, value);
    }
    // أي تغيير في المرشّحات يعيدنا إلى الصفحة الأولى — نتيجة صفحة 7 لمرشّح جديد مربكة
    sp.delete("page");
    router.push(`/reports?${sp.toString()}`);
    setPending(false);
  }

  function reset() {
    router.push(`/reports?category=${report.category}&report=${report.key}`);
  }

  const activeChips = [...params.entries()].filter(
    ([k, v]) => !["category", "report", "page", "sort", "dir"].includes(k) && v,
  );

  const inputCls = "min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0";

  return (
    <div className="mb-4 rounded-xl border border-sand-200 bg-white p-3">
      <form action={apply} className="flex flex-wrap items-end gap-3">
        {filters.includes("search") && (
          <div className="min-w-40 flex-1">
            <label htmlFor="f-search" className="mb-1 block text-xs text-gray-500">بحث</label>
            <input id="f-search" name="search" defaultValue={current("search")} className={inputCls} />
          </div>
        )}
        {filters.includes("dateRange") && (
          <>
            <div className="basis-36">
              <label htmlFor="f-from" className="mb-1 block text-xs text-gray-500">من تاريخ</label>
              <input id="f-from" name="dateFrom" type="date" defaultValue={current("dateFrom")} className={inputCls} />
            </div>
            <div className="basis-36">
              <label htmlFor="f-to" className="mb-1 block text-xs text-gray-500">إلى تاريخ</label>
              <input id="f-to" name="dateTo" type="date" defaultValue={current("dateTo")} className={inputCls} />
            </div>
          </>
        )}
        {filters.includes("status") && statusOptions.length > 0 && (
          <div className="basis-40">
            <label htmlFor="f-status" className="mb-1 block text-xs text-gray-500">الحالة</label>
            <select id="f-status" name="status" defaultValue={current("status")} className={inputCls}>
              <option value="">— الكل —</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        )}
        {filters.includes("item") && itemOptions.length > 0 && (
          <div className="basis-44">
            <label htmlFor="f-item" className="mb-1 block text-xs text-gray-500">بند الصرف</label>
            <select id="f-item" name="itemId" defaultValue={current("itemId")} className={inputCls}>
              <option value="">— الكل —</option>
              {itemOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>
        )}
        {filters.includes("person") && personOptions.length > 0 && (
          <div className="basis-48">
            <label htmlFor="f-person" className="mb-1 block text-xs text-gray-500">الموظف</label>
            <select id="f-person" name="personId" defaultValue={current("personId")} className={inputCls}>
              <option value="">— الكل —</option>
              {personOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 lg:min-h-0"
          >
            تطبيق
          </button>
          {activeChips.length > 0 && (
            <button
              type="button"
              onClick={reset}
              className="min-h-11 rounded-lg border border-sand-200 px-3 py-2 text-sm text-gray-600 hover:bg-sand-100 lg:min-h-0"
            >
              مسح المرشّحات
            </button>
          )}
        </div>
      </form>

      {activeChips.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-sand-100 pt-2">
          <span className="text-xs text-gray-500">المرشّحات المطبَّقة:</span>
          {activeChips.map(([k, v]) => (
            <span key={k} className="rounded-full bg-sand-100 px-2 py-0.5 text-xs text-gray-700">
              {FILTER_LABELS[k] ?? k}: {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const FILTER_LABELS: Record<string, string> = {
  search: "بحث",
  dateFrom: "من",
  dateTo: "إلى",
  status: "الحالة",
  itemId: "البند",
  personId: "الموظف",
};

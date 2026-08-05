"use client";

import { useActionState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SubmitButton } from "@/components/ui";
import { useRefreshOnSuccess } from "@/components/form-reset";
import { saveTemplateAction, updateTemplateAction, type ActionState } from "./actions";

/**
 * عناصر تأليف التقرير (v2.5.0 §4.2).
 *
 * الحالة كلها في عنوان URL كبقية المنصة: فالمعاينة على الخادم ترى ما يراه المستخدم،
 * والقالب يُحفظ من نص الاستعلام نفسه، والرابط قابل للمشاركة والرجوع.
 *
 * الأعمدة تُرتَّب بترتيب اختيارها لا بترتيب تعريفها: «ترتيب الأعمدة» في التكليف يعني
 * أن المستخدم يقرّر أيها أولاً، فيُلحَق العمود عند تحديده ويُزال عند إلغائه.
 */

const inputCls = "min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0";

export function BuilderControls({
  reportKey,
  columns,
  chosen,
  groupOptions,
  modes,
}: {
  reportKey: string;
  columns: { key: string; label: string }[];
  chosen: string[];
  groupOptions: { key: string; label: string }[];
  modes: { key: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function push(next: URLSearchParams) {
    next.set("report", reportKey);
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`);
  }

  function toggleColumn(key: string) {
    const next = new URLSearchParams(params);
    const current = next.getAll("col");
    // بلا اختيار صريح: كل الأعمدة ضمنياً — أول نقرة تُثبّتها ثم تُزيل المنقور
    const base = current.length > 0 ? current : columns.map((c) => c.key);
    const after = base.includes(key) ? base.filter((k) => k !== key) : [...base, key];
    next.delete("col");
    for (const k of after) next.append("col", k);
    push(next);
  }

  function moveColumn(key: string, delta: number) {
    const next = new URLSearchParams(params);
    const current = next.getAll("col");
    const base = current.length > 0 ? [...current] : columns.map((c) => c.key);
    const i = base.indexOf(key);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= base.length) return;
    [base[i], base[j]] = [base[j], base[i]];
    next.delete("col");
    for (const k of base) next.append("col", k);
    push(next);
  }

  function setScalar(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    push(next);
  }

  const selected = params.getAll("col");
  const effective = selected.length > 0 ? selected : columns.map((c) => c.key);
  const ordered = effective.map((k) => columns.find((c) => c.key === k)).filter(Boolean) as typeof columns;
  const unselected = columns.filter((c) => !effective.includes(c.key));

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-xs text-gray-500">الأعمدة المعروضة وترتيبها ({ordered.length} من {columns.length})</p>
        <ul className="space-y-1">
          {ordered.map((c, i) => (
            <li key={c.key} className="flex items-center gap-2 rounded border border-sand-200 px-2 py-1">
              <span className="min-w-0 flex-1 truncate text-sm">{c.label}</span>
              <button
                type="button"
                onClick={() => moveColumn(c.key, -1)}
                disabled={i === 0}
                aria-label={`تقديم ${c.label}`}
                className="rounded border border-sand-200 px-2 py-0.5 text-xs disabled:opacity-40"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveColumn(c.key, 1)}
                disabled={i === ordered.length - 1}
                aria-label={`تأخير ${c.label}`}
                className="rounded border border-sand-200 px-2 py-0.5 text-xs disabled:opacity-40"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => toggleColumn(c.key)}
                aria-label={`إخفاء ${c.label}`}
                className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-700"
              >
                إخفاء
              </button>
            </li>
          ))}
        </ul>
        {unselected.length > 0 && (
          <div className="mt-2">
            <p className="mb-1 text-xs text-gray-500">أعمدة مخفية — اضغط لإظهارها</p>
            <div className="flex flex-wrap gap-1.5">
              {unselected.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => toggleColumn(c.key)}
                  className="rounded-full border border-sand-200 px-2 py-1 text-xs text-gray-600 hover:bg-sand-50"
                >
                  + {c.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="b-sort" className="mb-1 block text-xs text-gray-500">الترتيب حسب</label>
          <select id="b-sort" defaultValue={params.get("sort") ?? ""} onChange={(e) => setScalar("sort", e.target.value)} className={inputCls}>
            <option value="">— بلا ترتيب مخصص —</option>
            {columns.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="b-dir" className="mb-1 block text-xs text-gray-500">الاتجاه</label>
          <select id="b-dir" defaultValue={params.get("dir") ?? "asc"} onChange={(e) => setScalar("dir", e.target.value)} className={inputCls}>
            <option value="asc">تصاعدي</option>
            <option value="desc">تنازلي</option>
          </select>
        </div>
        <div>
          <label htmlFor="b-mode" className="mb-1 block text-xs text-gray-500">نمط العرض</label>
          <select id="b-mode" defaultValue={params.get("mode") ?? ""} onChange={(e) => setScalar("mode", e.target.value)} className={inputCls}>
            {modes.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </div>
        {groupOptions.length > 0 && (
          <div>
            <label htmlFor="b-group" className="mb-1 block text-xs text-gray-500">التجميع حسب</label>
            <select id="b-group" defaultValue={params.get("group") ?? ""} onChange={(e) => setScalar("group", e.target.value)} className={inputCls}>
              <option value="">— بلا تجميع —</option>
              {groupOptions.map((g) => (
                <option key={g.key} value={g.key}>{g.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

export function SaveTemplateForm({
  reportKey,
  query,
  columns,
  visibilities,
  editing,
}: {
  reportKey: string;
  query: string;
  columns: string[];
  visibilities: string[];
  editing: { id: string; name: string; description: string | null; visibility: string } | null;
}) {
  const action = editing ? updateTemplateAction.bind(null, editing.id) : saveTemplateAction;
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);

  return (
    <form action={formAction} className="space-y-3">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}

      <input type="hidden" name="reportKey" value={reportKey} />
      {/* المرشّحات تُمرَّر كنص استعلام ثم تُقرأ على الخادم بالمحلّل المُقيَّد نفسه */}
      <input type="hidden" name="query" value={query} />
      {columns.map((c) => (
        <input key={c} type="hidden" name="col" value={c} />
      ))}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="t-name" className="mb-1 block text-xs text-gray-500">اسم القالب</label>
          <input id="t-name" name="name" defaultValue={editing?.name ?? ""} className={inputCls} />
        </div>
        <div>
          <label htmlFor="t-vis" className="mb-1 block text-xs text-gray-500">نطاق المشاركة</label>
          <select id="t-vis" name="visibility" defaultValue={editing?.visibility ?? "خاص"} className={inputCls}>
            {visibilities.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="t-desc" className="mb-1 block text-xs text-gray-500">
            الوصف <span className="text-gray-400">(اختياري)</span>
          </label>
          <input id="t-desc" name="description" defaultValue={editing?.description ?? ""} className={inputCls} />
        </div>
      </div>

      <p className="text-xs text-gray-500">
        القالب إعداد محفوظ يقرأ البيانات الحالية عند كل تشغيل — ليس نسخة مجمّدة، وحذفه لا
        يمسّ أي بيانات ولا أي تقرير صدر منه.
      </p>
      <SubmitButton>{editing ? "حفظ التعديل" : "حفظ كقالب"}</SubmitButton>
    </form>
  );
}

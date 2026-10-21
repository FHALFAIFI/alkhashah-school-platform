"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  FILTER_DEFS,
  FILTER_FLAGS,
  DEFAULT_LOW_THRESHOLD,
  readListParam,
  writeListParam,
  type FilterKey,
  type FilterFlag,
} from "@/lib/reports/filters";

/**
 * لوحة المرشّحات الموحّدة (v2.5.0 §3).
 *
 * ── لماذا لوحة واحدة ──────────────────────────────────────────────────────
 * كان لكل شاشة شريط مرشّحات خاص بها بمعانٍ متقاربة لا متطابقة، فاختلفت نتيجة «الحالة»
 * بين الشاشة والتقرير. هنا تعريف عرض واحد فوق تعريف بيانات واحد (`lib/reports/filters`)،
 * ويستعمله مركز التقارير والمنشئ والشاشات التشغيلية.
 *
 * ── الحالة في العنوان، لا في ذاكرة المكوّن ────────────────────────────────
 * كل مرشّح معامل في عنوان URL: الرابط قابل للمشاركة، وأزرار رجوع/تقدّم المتصفّح تعيد
 * المرشّحات كما كانت (§3.2)، والتصدير يقرأ المعاملات نفسها فيخرج المُصدَّر مطابقاً
 * للشاشة (§3.4).
 *
 * ── الاستمرار خلال الجلسة ─────────────────────────────────────────────────
 * عند العودة إلى الشاشة بلا معاملات، تُستعاد آخر مرشّحات استُعملت لهذا المفتاح من
 * `sessionStorage`. التخزين للجلسة وحدها: مرشّح منسيّ من الأسبوع الماضي يُنتج تقريراً
 * فارغاً محيّراً. وتُعرض دائماً شرائح المرشّحات الفعّالة وعدد النتائج، فلا يبقى الفراغ
 * بلا تفسير.
 */

export type Option = { value: string; label: string };

export type FilterOptions = Partial<{
  status: string[];
  people: Option[];
  items: Option[];
  domains: string[];
  owners: string[];
  committees: Option[];
  programs: Option[];
  jobTitles: string[];
  departments: string[];
  cycles: Option[];
  categories: string[];
  priorities: string[];
  rooms: Option[];
  weeks: string[];
  years: string[];
  employeeTypes: string[];
}>;

const MULTI_PARAM: Partial<Record<FilterKey, string>> = {
  status: "status",
  person: "personId",
  item: "itemId",
  domain: "domain",
  owner: "owner",
  committee: "committeeId",
  program: "programId",
  employeeType: "empType",
  jobTitle: "jobTitle",
  department: "dept",
  cycle: "cycleId",
  category: "recordCategory", // D-068 — `category` محجوز لتنقّل مركز التقارير
  priority: "priority",
  location: "roomId",
};

const inputCls = "min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0";

/** مفاتيح استُعيدت مرشّحاتها في هذه الجلسة — تبقى بين تركيبات اللوحة ما بقيت الصفحة محمّلة */
const restoredKeys = new Set<string>();

export function FilterPanel({
  filterKeys,
  options,
  flags = [],
  resultCount,
  storageKey,
  keep = {},
}: {
  filterKeys: FilterKey[];
  options: FilterOptions;
  /** العلامات المنطقية المعروضة لهذه الشاشة */
  flags?: FilterFlag[];
  /** عدد السجلات المطابقة — يُعرض دائماً ولو كان صفراً (§3.2) */
  resultCount?: number;
  /** مفتاح حفظ المرشّحات لهذه الجلسة — غيابه يعطّل الاستعادة */
  storageKey?: string;
  /** معاملات تبقى كما هي عند تغيير المرشّحات (الفئة، التقرير، القالب) */
  keep?: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);

  const query = params.toString();

  /*
   * استعادة مرشّحات الجلسة عند الدخول بلا معاملات — **مرة واحدة لكل مفتاح في الجلسة**،
   * لا مرة واحدة لكل تركيب.
   *
   * الفرق ليس تفصيلاً: بعد «مسح الفلاتر» أو رفع آخر مرشّح يعود العنوان بلا معاملات، وقد
   * يُعاد تركيب اللوحة مع التصيير الجديد — فكانت الاستعادة تنطلق من جديد وتُرجع بـ
   * `router.replace` مرشّحاً رفعه المستخدم للتوّ. ومن حيث لا يُرى: إن وقع ذلك بينما نقرة
   * أخرى في الطريق، ألغى أحد الانتقالين الآخر فضاعت النقرة بلا أثر.
   */
  useEffect(() => {
    if (!storageKey || restoredKeys.has(storageKey)) return;
    restoredKeys.add(storageKey);
    const meaningful = [...params.keys()].some((k) => !(k in keep) && k !== "page");
    if (meaningful) return;
    const saved = typeof window === "undefined" ? null : window.sessionStorage.getItem(`filters:${storageKey}`);
    if (saved) router.replace(`${pathname}?${saved}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    window.sessionStorage.setItem(`filters:${storageKey}`, query);
  }, [query, storageKey]);

  const chips = useMemo(() => activeChips(params, options), [params, options]);

  function push(next: URLSearchParams) {
    next.delete("page"); // أي تغيير في الترشيح يعيدنا إلى الصفحة الأولى
    router.push(`${pathname}?${next.toString()}`);
  }

  function setScalar(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    push(next);
  }

  function toggleMulti(name: string, value: string) {
    const next = new URLSearchParams(params);
    const current = readListParam(next, name);
    const after = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    writeListParam(next, name, after);
    push(next);
  }

  function setAll(name: string, values: string[]) {
    const next = new URLSearchParams(params);
    writeListParam(next, name, values);
    push(next);
  }

  function clearAll() {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(keep)) if (v) next.set(k, v);
    if (storageKey && typeof window !== "undefined") window.sessionStorage.removeItem(`filters:${storageKey}`);
    router.push(`${pathname}?${next.toString()}`);
  }

  function removeChip(param: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(param);
    else writeListParam(next, param, readListParam(next, param).filter((v) => v !== value));
    push(next);
  }

  const shown = filterKeys.filter((k) => hasOptionsFor(k, options));

  return (
    <section className="mb-4 rounded-xl border border-sand-200 bg-white print:hidden" aria-label="مرشّحات العرض">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sand-100 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="min-h-11 rounded-lg px-2 text-sm font-medium text-brand-800 hover:bg-sand-50 lg:min-h-0"
        >
          {open ? "إخفاء المرشّحات" : "المرشّحات"}
          {chips.length > 0 && (
            <span className="ms-2 rounded-full bg-brand-100 px-2 py-0.5 text-xs tabular-nums text-brand-800">
              {chips.length}
            </span>
          )}
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {resultCount !== undefined && (
            <span className="text-sm text-gray-600">
              عدد النتائج: <span className="font-bold tabular-nums text-brand-900">{resultCount.toLocaleString("ar-SA")}</span>
            </span>
          )}
          {chips.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="min-h-11 rounded-lg border border-sand-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-sand-100 lg:min-h-0"
            >
              مسح الفلاتر
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((key) => (
            <FilterControl
              key={key}
              filterKey={key}
              options={options}
              params={params}
              onScalar={setScalar}
              onToggle={toggleMulti}
              onSetAll={setAll}
            />
          ))}

          {flags.length > 0 && (
            <fieldset className="sm:col-span-2 lg:col-span-3">
              <legend className="mb-1 text-xs text-gray-500">{FILTER_DEFS.flags.labelAr}</legend>
              <div className="flex flex-wrap gap-2">
                {flags.map((f) => {
                  const active = readListParam(params, "flag").includes(f);
                  return (
                    <button
                      key={f}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleMulti("flag", f)}
                      className={`min-h-11 rounded-full border px-3 py-1.5 text-xs lg:min-h-0 ${
                        active ? "border-brand-500 bg-brand-50 font-medium text-brand-800" : "border-sand-200 text-gray-600 hover:bg-sand-50"
                      }`}
                    >
                      {FILTER_FLAGS[f]}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

        </div>
      )}

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-sand-100 px-3 py-2">
          <span className="text-xs text-gray-500">المرشّحات المطبَّقة:</span>
          {chips.map((c) => (
            <button
              key={`${c.param}:${c.value ?? ""}`}
              type="button"
              onClick={() => removeChip(c.param, c.value)}
              className="group inline-flex items-center gap-1 rounded-full bg-sand-100 px-2 py-0.5 text-xs text-gray-700 hover:bg-red-50 hover:text-red-800"
              title="إزالة هذا المرشّح"
            >
              <span>{c.label}: {c.display}</span>
              <span aria-hidden className="text-gray-400 group-hover:text-red-600">×</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/* ─────────────────────────── عناصر التحكم ─────────────────────────── */

function FilterControl({
  filterKey,
  options,
  params,
  onScalar,
  onToggle,
  onSetAll,
}: {
  filterKey: FilterKey;
  options: FilterOptions;
  params: URLSearchParams;
  onScalar: (name: string, value: string) => void;
  onToggle: (name: string, value: string) => void;
  onSetAll: (name: string, values: string[]) => void;
}) {
  const def = FILTER_DEFS[filterKey];

  /*
   * §7.5: الحد قابل للتحرير على الشاشة، لا في العنوان وحده.
   *
   * `onBlur` وحده لا يكفي: المدير يكتب الرقم ثم يضغط «توليد» أو ينتقل مباشرةً، فتضيع القيمة
   * لأن الحقل لم يفقد التركيز قط. لذلك يُلتقط Enter أيضاً. القيمة الفارغة تعني «أعِد الافتراضي»
   * فتُحذف من العنوان بدل أن تُثبَّت صفراً.
   */
  if (filterKey === "lowThreshold") {
    const commit = (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed === "") return onScalar("lowThreshold", "");
      const n = Number(trimmed);
      if (!Number.isFinite(n)) return onScalar("lowThreshold", "");
      onScalar("lowThreshold", String(Math.min(100, Math.max(0, Math.round(n)))));
    };
    return (
      <div>
        <label htmlFor="f-low" className="mb-1 block text-xs text-gray-500">
          {def.labelAr} (٪) — الافتراضي {DEFAULT_LOW_THRESHOLD}
        </label>
        <input
          id="f-low"
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          step={1}
          aria-describedby="f-low-hint"
          defaultValue={params.get("lowThreshold") ?? String(DEFAULT_LOW_THRESHOLD)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit((e.target as HTMLInputElement).value);
            }
          }}
          className={inputCls}
        />
        <p id="f-low-hint" className="mt-1 text-xs text-gray-400">{def.hintAr}</p>
      </div>
    );
  }

  if (filterKey === "search") {
    return (
      <div>
        <label htmlFor="f-search" className="mb-1 block text-xs text-gray-500">{def.labelAr}</label>
        <input
          id="f-search"
          defaultValue={params.get("search") ?? ""}
          onBlur={(e) => onScalar("search", e.target.value.trim())}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onScalar("search", (e.target as HTMLInputElement).value.trim());
            }
          }}
          className={inputCls}
        />
      </div>
    );
  }

  if (filterKey === "dateRange") {
    return (
      <div className="flex gap-2">
        <div className="flex-1">
          <label htmlFor="f-from" className="mb-1 block text-xs text-gray-500">من تاريخ</label>
          <input id="f-from" type="date" defaultValue={params.get("dateFrom") ?? ""} onChange={(e) => onScalar("dateFrom", e.target.value)} className={inputCls} />
        </div>
        <div className="flex-1">
          <label htmlFor="f-to" className="mb-1 block text-xs text-gray-500">إلى تاريخ</label>
          <input id="f-to" type="date" defaultValue={params.get("dateTo") ?? ""} onChange={(e) => onScalar("dateTo", e.target.value)} className={inputCls} />
        </div>
      </div>
    );
  }

  if (def.kind === "numberRange") {
    const [minParam, maxParam] = def.params;
    return (
      <div className="flex gap-2">
        <div className="flex-1">
          <label htmlFor={`f-${minParam}`} className="mb-1 block text-xs text-gray-500">{def.labelAr} — من</label>
          <input id={`f-${minParam}`} type="number" defaultValue={params.get(minParam) ?? ""} onBlur={(e) => onScalar(minParam, e.target.value)} className={inputCls} />
        </div>
        <div className="flex-1">
          <label htmlFor={`f-${maxParam}`} className="mb-1 block text-xs text-gray-500">إلى</label>
          <input id={`f-${maxParam}`} type="number" defaultValue={params.get(maxParam) ?? ""} onBlur={(e) => onScalar(maxParam, e.target.value)} className={inputCls} />
        </div>
      </div>
    );
  }

  if (filterKey === "week" || filterKey === "academicYear") {
    const param = def.params[0];
    const values = (filterKey === "week" ? options.weeks : options.years) ?? [];
    return (
      <div>
        <label htmlFor={`f-${param}`} className="mb-1 block text-xs text-gray-500">{def.labelAr}</label>
        <select id={`f-${param}`} defaultValue={params.get(param) ?? ""} onChange={(e) => onScalar(param, e.target.value)} className={inputCls}>
          <option value="">— الكل —</option>
          {values.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </div>
    );
  }

  const param = MULTI_PARAM[filterKey];
  if (!param) return null;
  const opts = optionsFor(filterKey, options);
  const selected = readListParam(params, param);

  return (
    <details className="rounded-lg border border-sand-200">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs text-gray-600">
        {def.labelAr}
        <span className="ms-2 text-gray-400">
          {selected.length === 0 ? "الكل" : `${selected.length.toLocaleString("ar-SA")} محدَّد`}
        </span>
      </summary>
      <div className="border-t border-sand-100 p-2">
        <div className="mb-2 flex gap-2">
          <button
            type="button"
            onClick={() => onSetAll(param, opts.map((o) => o.value))}
            className="rounded border border-sand-200 px-2 py-1 text-xs text-gray-600 hover:bg-sand-50"
          >
            تحديد الكل
          </button>
          <button
            type="button"
            onClick={() => onSetAll(param, [])}
            className="rounded border border-sand-200 px-2 py-1 text-xs text-gray-600 hover:bg-sand-50"
          >
            مسح الكل
          </button>
        </div>
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {opts.map((o) => (
            <li key={o.value}>
              <label className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-sand-50">
                <input type="checkbox" checked={selected.includes(o.value)} onChange={() => onToggle(param, o.value)} />
                <span className="min-w-0 truncate">{o.label}</span>
              </label>
            </li>
          ))}
          {opts.length === 0 && <li className="px-1 py-1 text-xs text-gray-400">لا خيارات متاحة</li>}
        </ul>
      </div>
    </details>
  );
}

/* ─────────────────────────── مساعدات ─────────────────────────── */

function asOptions(values: string[] | undefined): Option[] {
  return (values ?? []).map((v) => ({ value: v, label: v }));
}

function optionsFor(key: FilterKey, options: FilterOptions): Option[] {
  switch (key) {
    case "status":
      return asOptions(options.status);
    case "person":
      return options.people ?? [];
    case "item":
      return options.items ?? [];
    case "domain":
      return asOptions(options.domains);
    case "owner":
      return asOptions(options.owners);
    case "committee":
      return options.committees ?? [];
    case "program":
      return options.programs ?? [];
    case "employeeType":
      return asOptions(options.employeeTypes);
    case "jobTitle":
      return asOptions(options.jobTitles);
    case "department":
      return asOptions(options.departments);
    case "cycle":
      return options.cycles ?? [];
    case "category":
      return asOptions(options.categories);
    case "priority":
      return asOptions(options.priorities);
    case "location":
      return options.rooms ?? [];
    default:
      return [];
  }
}

/** لا يُعرض مرشّح متعدّد بلا خيارات — الحقل الفارغ يوحي بعطل */
function hasOptionsFor(key: FilterKey, options: FilterOptions): boolean {
  const def = FILTER_DEFS[key];
  // العتبة لا تُشتق من البيانات — لها دائماً قيمة صالحة (الافتراضي)، فتُعرض دائماً.
  if (def.kind === "text" || def.kind === "dateRange" || def.kind === "numberRange" || def.kind === "threshold") return true;
  if (key === "week") return (options.weeks ?? []).length > 0;
  if (key === "academicYear") return (options.years ?? []).length > 0;
  return optionsFor(key, options).length > 0;
}

type Chip = { param: string; value: string | null; label: string; display: string };

/** شرائح المرشّحات الفعّالة — تُقرأ من العنوان مباشرةً فتطابق ما يُرسل إلى الخادم */
function activeChips(params: URLSearchParams, options: FilterOptions): Chip[] {
  const chips: Chip[] = [];
  const nameOf = (list: Option[] | undefined, value: string) => list?.find((o) => o.value === value)?.label ?? value;

  for (const [key, param] of Object.entries(MULTI_PARAM) as [FilterKey, string][]) {
    for (const value of readListParam(params, param)) {
      const opts = optionsFor(key, options);
      chips.push({ param, value, label: FILTER_DEFS[key].labelAr, display: nameOf(opts, value) });
    }
  }
  for (const flag of readListParam(params, "flag")) {
    chips.push({
      param: "flag",
      value: flag,
      label: FILTER_DEFS.flags.labelAr,
      display: FILTER_FLAGS[flag as FilterFlag] ?? flag,
    });
  }
  const scalars: [string, string][] = [
    ["search", "بحث"],
    ["dateFrom", "من"],
    ["dateTo", "إلى"],
    ["week", "الأسبوع"],
    ["year", "العام الدراسي"],
    ["minScore", "النتيجة من"],
    ["maxScore", "النتيجة إلى"],
    ["minAmount", "المبلغ من"],
    ["maxAmount", "المبلغ إلى"],
    ["minProgress", "الإنجاز من"],
    ["maxProgress", "الإنجاز إلى"],
  ];
  for (const [param, label] of scalars) {
    const v = params.get(param);
    if (v) chips.push({ param, value: null, label, display: v });
  }
  const low = params.get("lowThreshold");
  if (low && Number(low) !== DEFAULT_LOW_THRESHOLD) {
    // التسمية من التعريف المشترك لا مكتوبة هنا: كانت الشريحة تقول «عتبة الأداء المنخفض»
    // بينما ترويسة الملف المُصدَّر تقول «حد الأداء المنخفض» — اسمان لمرشّح واحد في المنتج نفسه.
    chips.push({ param: "lowThreshold", value: null, label: FILTER_DEFS.lowThreshold.labelAr, display: `أقل من ${low}٪` });
  }
  return chips;
}

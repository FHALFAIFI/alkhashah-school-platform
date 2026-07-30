"use client";

/**
 * حقل تاريخ مزدوج التقويم (D-033):
 * - المستخدم يختار تقويم الإدخال (هجري أم القرى / ميلادي) بمبدّل ظاهر بجوار الحقل.
 * - القيمة المخزنة قيمة واحدة قانونية: ميلادي ISO (YYYY-MM-DD) في حقل النموذج نفسه.
 * - الإدخال الهجري بقوائم (يوم/شهر بالاسم/سنة) فلا يمكن إدخال تاريخ ملتبس أو مستحيل.
 * - أسفل الحقل سطر مزدوج كامل: «15 أغسطس 2026م — 2 ربيع الأول 1448هـ».
 * - الوضع الافتراضي ميلادي (يحافظ على سلوك النماذج القائمة)، واختيار المستخدم
 *   يُتذكّر في المتصفح ويُطبَّق بعد التركيب (لا فرق ترطيب — D-029).
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import {
  GREGORIAN_MONTHS_AR,
  HIJRI_MONTHS,
  fullDualLine,
  hijriMonthLength,
  hijriPartsOf,
  hijriToIso,
  parseIsoDate,
} from "@/lib/dates";

const MODE_STORAGE_KEY = "madrasa-datefield-mode-v1";
const HIJRI_YEARS = Array.from({ length: 26 }, (_, i) => 1440 + i); // 1440–1465هـ

type Mode = "ميلادي" | "هجري";

const inputCls =
  "min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 lg:min-h-0";

/**
 * مخزن تفضيل التقويم — useSyncExternalStore هو النمط الآمن للترطيب:
 * الخادم يعرض «ميلادي» دائماً، وبعد التركيب يُقرأ تفضيل المتصفح فتتزامن
 * كل حقول التاريخ على الصفحة معاً دون فرق ترطيب (D-029).
 */
const modeListeners = new Set<() => void>();

function subscribeMode(cb: () => void) {
  modeListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    modeListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function getModeSnapshot(): Mode {
  try {
    const v = window.localStorage.getItem(MODE_STORAGE_KEY);
    return v === "هجري" ? "هجري" : "ميلادي";
  } catch {
    return "ميلادي";
  }
}

function getModeServerSnapshot(): Mode {
  return "ميلادي";
}

function storeMode(next: Mode) {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, next);
  } catch {
    // التفضيل تحسين فقط
  }
  for (const cb of modeListeners) cb();
}

export function DateField({
  label,
  name,
  defaultValue,
  required,
  hint,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  required?: boolean;
  hint?: string;
}) {
  const initialIso = defaultValue && parseIsoDate(defaultValue) ? defaultValue.slice(0, 10) : "";
  const mode = useSyncExternalStore(subscribeMode, getModeSnapshot, getModeServerSnapshot);
  const [iso, setIso] = useState(initialIso);

  const hijri = useMemo(() => {
    const d = iso ? parseIsoDate(iso) : null;
    return d ? hijriPartsOf(d) : null;
  }, [iso]);

  const dualLine = useMemo(() => (iso ? fullDualLine(iso) : null), [iso]);

  function switchMode(next: Mode) {
    storeMode(next);
  }

  function setHijriPart(part: "day" | "month" | "year", value: number) {
    const current = hijri ?? { year: 1447, month: 1, day: 1 };
    const next = { ...current, [part]: value };
    // ثبّت اليوم داخل طول الشهر الفعلي (29/30) عند تغيير الشهر أو السنة
    const len = hijriMonthLength(next.year, next.month);
    if (next.day > len) next.day = len;
    const nextIso = hijriToIso(next);
    if (nextIso) setIso(nextIso);
  }

  const hijriDayCount = hijri ? hijriMonthLength(hijri.year, hijri.month) : 30;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={`${name}-input`} className="block text-sm font-medium text-gray-700">
          <span>{label}</span>
          {required && <span className="text-red-500"> *</span>}
        </label>
        <div
          className="inline-flex overflow-hidden rounded-md border border-gray-300 text-xs"
          role="group"
          aria-label={`تقويم إدخال ${label}`}
        >
          {(["ميلادي", "هجري"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              aria-pressed={mode === m}
              className={`px-2 py-1 transition ${
                mode === m
                  ? "bg-brand-600 font-medium text-white"
                  : "bg-white text-gray-600 hover:bg-sand-100"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* القيمة القانونية الوحيدة المرسلة للخادم: ميلادي ISO */}
      {mode === "هجري" && <input type="hidden" name={name} value={iso} />}

      {mode === "ميلادي" ? (
        <input
          id={`${name}-input`}
          name={name}
          type="date"
          value={iso}
          onChange={(e) => setIso(e.target.value)}
          required={required}
          autoComplete="off"
          data-1p-ignore=""
          data-lpignore="true"
          className={inputCls}
        />
      ) : (
        <div className="grid grid-cols-[4.5rem_1fr_5.5rem] gap-1.5">
          <select
            id={`${name}-input`}
            aria-label="اليوم (هجري)"
            value={hijri?.day ?? ""}
            onChange={(e) => setHijriPart("day", Number(e.target.value))}
            required={required && !iso}
            className={inputCls}
          >
            <option value="" disabled>
              اليوم
            </option>
            {Array.from({ length: hijriDayCount }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select
            aria-label="الشهر (هجري)"
            value={hijri?.month ?? ""}
            onChange={(e) => setHijriPart("month", Number(e.target.value))}
            required={required && !iso}
            className={inputCls}
          >
            <option value="" disabled>
              الشهر
            </option>
            {HIJRI_MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <select
            aria-label="السنة (هجري)"
            value={hijri?.year ?? ""}
            onChange={(e) => setHijriPart("year", Number(e.target.value))}
            required={required && !iso}
            className={inputCls}
          >
            <option value="" disabled>
              السنة
            </option>
            {HIJRI_YEARS.map((y) => (
              <option key={y} value={y}>
                {y}هـ
              </option>
            ))}
          </select>
        </div>
      )}

      {dualLine ? (
        <p className="mt-1 text-xs text-gray-500 tabular-nums">{dualLine}</p>
      ) : (
        mode === "هجري" &&
        !iso && <p className="mt-1 text-xs text-gray-400">اختر اليوم والشهر والسنة الهجرية</p>
      )}
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

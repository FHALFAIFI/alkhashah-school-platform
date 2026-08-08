"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import {
  createTemplateAction,
  saveTemplateConfigAction,
  publishVersionAction,
  restoreVersionAction,
  resetToDefaultAction,
  duplicateTemplateAction,
  setDefaultTemplateAction,
  archiveTemplateAction,
  restoreTemplateAction,
  archiveDraftVersionAction,
  importTemplateConfigAction,
  previewWithRecordAction,
  type ActionState,
} from "./actions";
import { SubmitButton, Field } from "@/components/ui";
import {
  DOC_TYPE_LABELS,
  TEMPLATE_COLORS,
  TEMPLATE_FONTS,
  TEXT_ALIGNMENTS,
  PAGE_ORIENTATIONS,
  BORDER_STYLES,
  DOC_NUMBER_POSITIONS,
  mergeWithDefaults,
  type TemplateConfig,
  type TemplateDocType,
} from "@/lib/templates/schema";
import { renderTemplate, sampleValues, sampleTable } from "@/lib/templates/render";
import { DOC_SECTIONS, columnsFor, resolveColumns, resolveSections } from "@/lib/templates/structure";
import type { PlaceholderDef } from "@/lib/templates/placeholders";
import { useResetOnSuccess, useRefreshAfterTransition } from "@/components/form-reset";
import { useRefreshOnSuccess } from "@/components/form-reset";

/**
 * محرّر القوالب (v2.2 §E2/§E4).
 *
 * المدير لا يكتب HTML ولا CSS: يختار من قوائم مغلقة ويكتب نصوصاً عربية. النموذج يبني
 * كائن الإعداد ويرسله، والخادم يتحقق منه مجدداً — لا يُوثق بتحقق العميل وحده.
 *
 * المعاينة تستعمل **مُصيِّر الإصدار نفسه**، فما يُعرض هنا هو ما سيصدر فعلاً.
 */

const ALIGN_LABELS: Record<string, string> = { right: "يمين", center: "وسط", left: "يسار", justify: "ضبط" };
const ORIENTATION_LABELS: Record<string, string> = { portrait: "طولي", landscape: "عرضي" };
const BORDER_LABELS: Record<string, string> = { solid: "متصل", dashed: "متقطع", none: "بلا إطار" };
const DOCNUM_LABELS: Record<string, string> = {
  "header-start": "الترويسة — البداية",
  "header-end": "الترويسة — النهاية",
  "footer-start": "التذييل — البداية",
  "footer-end": "التذييل — النهاية",
  hidden: "مخفي",
};

export function CreateTemplateForm({ docTypes }: { docTypes: { value: string; label: string }[] }) {
  const [state, formAction] = useActionState<ActionState, FormData>(createTemplateAction, null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);
  // مرجع تفريغ الحقول بعد النجاح — يُستدعى دائماً (قواعد الخطّافات)
  const formRef = useResetOnSuccess(state);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="min-h-11 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 lg:min-h-0"
      >
        {open ? "إغلاق" : "إنشاء قالب"}
      </button>
      {open && (
        <form ref={formRef} action={formAction} className="mt-3 space-y-3 rounded-lg bg-sand-50 p-3">
          {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
          {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
          <div>
            <label htmlFor="tpl-type" className="mb-1 block text-sm font-medium text-gray-700">نوع الوثيقة</label>
            <select id="tpl-type" name="docType" className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0">
              {docTypes.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <Field label="اسم القالب (اختياري)" name="nameAr" />
          <Field label="الوصف (اختياري)" name="description" />
          <SubmitButton>إنشاء كمسودة</SubmitButton>
        </form>
      )}
    </div>
  );
}

/** أزرار دورة حياة القالب — كلها idempotent على الخادم */
export function TemplateActions({
  templateId,
  archived,
  isDefault,
  canSetDefault,
}: {
  templateId: string;
  archived: boolean;
  isDefault: boolean;
  canSetDefault: boolean;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // D-053: التحديث بعد اكتمال الانتقال — الإجراء لم يعد يُبطل أي مسار
  useRefreshAfterTransition(pending);
  const run = (fn: () => Promise<ActionState>, confirmText?: string) =>
    startTransition(async () => {
      if (confirmText && !window.confirm(confirmText)) return;
      const res = await fn();
      setMsg(res?.error ?? res?.success ?? null);
    });
  const btn = "text-xs text-gray-600 hover:underline disabled:opacity-50";
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {!archived && !isDefault && canSetDefault && (
        <button disabled={pending} className={btn} onClick={() => run(() => setDefaultTemplateAction(templateId))}>
          تعيين افتراضياً
        </button>
      )}
      {!archived && (
        <button disabled={pending} className={btn} onClick={() => run(() => duplicateTemplateAction(templateId))}>
          تكرار
        </button>
      )}
      {!archived && (
        <button
          disabled={pending}
          className={btn}
          onClick={() => run(() => resetToDefaultAction(templateId), "إنشاء نسخة جديدة بالإعداد الافتراضي؟ النسخ الحالية لا تتغيّر.")}
        >
          إعادة الافتراضي
        </button>
      )}
      <button
        disabled={pending}
        className={btn}
        onClick={() =>
          run(
            () => (archived ? restoreTemplateAction(templateId) : archiveTemplateAction(templateId)),
            archived ? undefined : "أرشفة القالب؟ النسخ والوثائق الصادرة تبقى محفوظة.",
          )
        }
      >
        {archived ? "استعادة" : "أرشفة"}
      </button>
      {msg && <span role="status" className="text-xs text-gray-500">{msg}</span>}
    </span>
  );
}

/** إجراءات نسخة واحدة: نشر، استعادة، حذف مسودة */
export function VersionActions({
  versionId,
  status,
  referenced,
}: {
  versionId: string;
  status: string;
  referenced: boolean;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // D-053: التحديث بعد اكتمال الانتقال — الإجراء لم يعد يُبطل أي مسار
  useRefreshAfterTransition(pending);
  const run = (fn: () => Promise<ActionState>, confirmText?: string) =>
    startTransition(async () => {
      if (confirmText && !window.confirm(confirmText)) return;
      const res = await fn();
      setMsg(res?.error ?? res?.success ?? null);
    });
  const btn = "text-xs text-gray-600 hover:underline disabled:opacity-50";
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {status === "مسودة" && (
        <button disabled={pending} className={btn} onClick={() => run(() => publishVersionAction(versionId), "نشر هذه النسخة؟ ستُستعمل في الوثائق الجديدة.")}>
          نشر
        </button>
      )}
      <button disabled={pending} className={btn} onClick={() => run(() => restoreVersionAction(versionId))}>
        استعادة كنسخة جديدة
      </button>
      {status === "مسودة" && !referenced && (
        <button disabled={pending} className={btn} onClick={() => run(() => archiveDraftVersionAction(versionId), "أرشفة هذه المسودة؟ رقم النسخة يبقى محجوزاً والتاريخ مقروءاً.")}>
          أرشفة المسودة
        </button>
      )}
      {msg && <span role="status" className="text-xs text-gray-500">{msg}</span>}
    </span>
  );
}

/**
 * محرّر الإعداد + المعاينة الحيّة.
 *
 * الحالة تُبنى ككائن إعداد مُقيَّد ثم تُرسل كـJSON. لا يوجد حقل نصي حر لـHTML أو CSS في
 * الواجهة أصلاً — القيود مبنية في نوع الإدخال لا مضافة كتحقق لاحق.
 */
export function TemplateEditor({
  templateId,
  docType,
  initialConfig,
  placeholders,
  recordOptions = [],
  recordPickerLabel = null,
  recordDenied = false,
}: {
  templateId: string;
  docType: TemplateDocType;
  initialConfig: TemplateConfig;
  placeholders: PlaceholderDef[];
  /** السجلات المتاحة للمعاينة الحقيقية — مُحمَّلة على الخادم بصلاحية نوعها */
  recordOptions?: { id: string; label: string }[];
  recordPickerLabel?: string | null;
  /** المستخدم لا يملك صلاحية قراءة سجلات هذا النوع — يُقال صراحةً لا يُخفى الخيار */
  recordDenied?: boolean;
}) {
  const [config, setConfig] = useState<TemplateConfig>(() => mergeWithDefaults(initialConfig));
  const [state, formAction] = useActionState<ActionState, FormData>(saveTemplateConfigAction.bind(null, templateId), null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);
  const [showPreview, setShowPreview] = useState(true);
  const [recordId, setRecordId] = useState("");
  const [recordPreview, setRecordPreview] = useState<{ html: string; recordLabel: string } | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [recordPending, startRecordPreview] = useTransition();
  // D-053: التحديث بعد اكتمال الانتقال — الإجراء لم يعد يُبطل أي مسار
  useRefreshAfterTransition(recordPending);

  const setText = (key: string, value: string) => setConfig((c) => ({ ...c, text: { ...(c.text ?? {}), [key]: value } }));
  const setStyle = (key: string, value: string | number | boolean) =>
    setConfig((c) => ({ ...c, style: { ...(c.style ?? {}), [key]: value } }));
  const setIdentity = (key: string, value: string) =>
    setConfig((c) => ({ ...c, identity: { ...(c.identity ?? {}), [key]: value } }));
  const setSig = (key: string, value: string | boolean) =>
    setConfig((c) => ({ ...c, signature: { ...(c.signature ?? {}), [key]: value } }));

  /**
   * الأقسام والأعمدة (§E2) — الحالة تُشتق دائماً من السجل المغلق، فلا يظهر في الواجهة
   * قسم أو عمود لا يعرفه المُصيِّر، ولا يُكتب في الإعداد مفتاح مخترع.
   */
  const sections = resolveSections(config.sections);
  const columns = resolveColumns(docType, config.columns);
  const availableColumns = columnsFor(docType);

  const writeSections = (next: typeof sections) =>
    setConfig((c) => ({
      ...c,
      sections: next.map((s, i) => ({
        key: s.key,
        ...(s.label ? { label: s.label } : {}),
        visible: s.visible,
        order: i,
      })),
    }));

  const writeColumns = (next: typeof columns) =>
    setConfig((c) => ({
      ...c,
      columns: next.map((col, i) => {
        const def = availableColumns.find((d) => d.key === col.key);
        return {
          key: col.key,
          // التسمية تُحفظ فقط إن غيّرها المدير — فيبقى الفرق بين النسخ مقروءاً
          ...(col.label && col.label !== def?.label ? { label: col.label } : {}),
          visible: col.visible,
          ...(col.width !== null ? { width: col.width } : {}),
          order: i,
        };
      }),
    }));

  const move = <T,>(list: T[], index: number, delta: number): T[] => {
    const target = index + delta;
    if (target < 0 || target >= list.length) return list;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  };

  // المعاينة تُصيَّر بمُصيِّر الإصدار نفسه ببيانات نموذجية (§E4)
  const previewHtml = useMemo(() => {
    try {
      return renderTemplate(config, { values: sampleValues(), docType, table: sampleTable(docType) });
    } catch {
      return "<p>تعذّرت المعاينة — راجع القيم</p>";
    }
  }, [config, docType]);

  const input = "min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0";
  const label = "mb-1 block text-xs text-gray-500";
  const t = config.text ?? {};
  const s = config.style ?? {};
  const idn = config.identity ?? {};
  const sig = config.signature ?? {};

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <form action={formAction} className="space-y-4">
        {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
        {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
        <input type="hidden" name="config" value={JSON.stringify(config)} />

        <fieldset className="rounded-lg border border-sand-200 p-3">
          <legend className="px-1 text-sm font-bold text-brand-900">النصوص</legend>
          <p className="mb-2 text-xs text-gray-400">كل الحقول اختيارية. يمكن استعمال العناصر النائبة أدناه.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className={label} htmlFor="t-title">العنوان</label><input id="t-title" className={input} value={t.titleAr ?? ""} onChange={(e) => setText("titleAr", e.target.value)} maxLength={200} /></div>
            <div><label className={label} htmlFor="t-sub">العنوان الفرعي</label><input id="t-sub" className={input} value={t.subtitleAr ?? ""} onChange={(e) => setText("subtitleAr", e.target.value)} maxLength={300} /></div>
            <div><label className={label} htmlFor="t-head">نص الترويسة</label><input id="t-head" className={input} value={t.headerText ?? ""} onChange={(e) => setText("headerText", e.target.value)} maxLength={500} /></div>
            <div><label className={label} htmlFor="t-foot">نص التذييل</label><input id="t-foot" className={input} value={t.footerText ?? ""} onChange={(e) => setText("footerText", e.target.value)} maxLength={500} /></div>
          </div>
          <div className="mt-3 space-y-3">
            <div><label className={label} htmlFor="t-intro">نص المقدمة</label><textarea id="t-intro" rows={2} className={input} value={t.introText ?? ""} onChange={(e) => setText("introText", e.target.value)} maxLength={3000} /></div>
            <div><label className={label} htmlFor="t-fixed">نص ثابت</label><textarea id="t-fixed" rows={2} className={input} value={t.fixedText ?? ""} onChange={(e) => setText("fixedText", e.target.value)} maxLength={3000} /></div>
            <div><label className={label} htmlFor="t-close">نص الخاتمة</label><textarea id="t-close" rows={2} className={input} value={t.closingText ?? ""} onChange={(e) => setText("closingText", e.target.value)} maxLength={3000} /></div>
            <div><label className={label} htmlFor="t-notes">ملاحظات</label><textarea id="t-notes" rows={2} className={input} value={t.notes ?? ""} onChange={(e) => setText("notes", e.target.value)} maxLength={2000} /></div>
            <div><label className={label} htmlFor="t-wm">نص العلامة المائية</label><input id="t-wm" className={input} value={t.watermarkText ?? ""} onChange={(e) => setText("watermarkText", e.target.value)} maxLength={80} /></div>
          </div>
        </fieldset>

        <fieldset className="rounded-lg border border-sand-200 p-3">
          <legend className="px-1 text-sm font-bold text-brand-900">الجهة والمدرسة</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className={label} htmlFor="i-school">اسم المدرسة</label><input id="i-school" className={input} value={idn.schoolName ?? ""} onChange={(e) => setIdentity("schoolName", e.target.value)} maxLength={200} /></div>
            <div><label className={label} htmlFor="i-min">نص الوزارة</label><input id="i-min" className={input} value={idn.ministryText ?? ""} onChange={(e) => setIdentity("ministryText", e.target.value)} maxLength={300} /></div>
            <div><label className={label} htmlFor="i-dep">إدارة التعليم</label><input id="i-dep" className={input} value={idn.departmentText ?? ""} onChange={(e) => setIdentity("departmentText", e.target.value)} maxLength={300} /></div>
          </div>
        </fieldset>

        <fieldset className="rounded-lg border border-sand-200 p-3">
          <legend className="px-1 text-sm font-bold text-brand-900">التنسيق</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div><label className={label} htmlFor="s-pc">اللون الأساسي</label>
              <select id="s-pc" className={input} value={s.primaryColor ?? ""} onChange={(e) => setStyle("primaryColor", e.target.value)}>
                {TEMPLATE_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select></div>
            <div><label className={label} htmlFor="s-tc">لون النص</label>
              <select id="s-tc" className={input} value={s.textColor ?? ""} onChange={(e) => setStyle("textColor", e.target.value)}>
                {TEMPLATE_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select></div>
            <div><label className={label} htmlFor="s-ff">الخط</label>
              <select id="s-ff" className={input} value={s.fontFamily ?? ""} onChange={(e) => setStyle("fontFamily", e.target.value)}>
                {TEMPLATE_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select></div>
            <div><label className={label} htmlFor="s-bs">حجم الخط</label><input id="s-bs" type="number" min={8} max={24} className={input} value={s.baseFontSize ?? 12} onChange={(e) => setStyle("baseFontSize", Number(e.target.value))} /></div>
            <div><label className={label} htmlFor="s-ts">حجم العنوان</label><input id="s-ts" type="number" min={8} max={24} className={input} value={s.titleFontSize ?? 16} onChange={(e) => setStyle("titleFontSize", Number(e.target.value))} /></div>
            <div><label className={label} htmlFor="s-lh">تباعد الأسطر</label><input id="s-lh" type="number" step="0.1" min={1} max={3} className={input} value={s.lineHeight ?? 1.7} onChange={(e) => setStyle("lineHeight", Number(e.target.value))} /></div>
            <div><label className={label} htmlFor="s-al">المحاذاة</label>
              <select id="s-al" className={input} value={s.textAlign ?? "right"} onChange={(e) => setStyle("textAlign", e.target.value)}>
                {TEXT_ALIGNMENTS.map((a) => <option key={a} value={a}>{ALIGN_LABELS[a]}</option>)}
              </select></div>
            <div><label className={label} htmlFor="s-or">اتجاه الصفحة</label>
              <select id="s-or" className={input} value={s.pageOrientation ?? "portrait"} onChange={(e) => setStyle("pageOrientation", e.target.value)}>
                {PAGE_ORIENTATIONS.map((o) => <option key={o} value={o}>{ORIENTATION_LABELS[o]}</option>)}
              </select></div>
            <div><label className={label} htmlFor="s-br">نمط الإطار</label>
              <select id="s-br" className={input} value={s.borderStyle ?? "solid"} onChange={(e) => setStyle("borderStyle", e.target.value)}>
                {BORDER_STYLES.map((b) => <option key={b} value={b}>{BORDER_LABELS[b]}</option>)}
              </select></div>
            <div><label className={label} htmlFor="s-mt">هامش أعلى (مم)</label><input id="s-mt" type="number" min={0} max={50} className={input} value={s.marginTop ?? 15} onChange={(e) => setStyle("marginTop", Number(e.target.value))} /></div>
            <div><label className={label} htmlFor="s-mb">هامش أسفل (مم)</label><input id="s-mb" type="number" min={0} max={50} className={input} value={s.marginBottom ?? 15} onChange={(e) => setStyle("marginBottom", Number(e.target.value))} /></div>
            <div><label className={label} htmlFor="s-dn">موضع رقم الوثيقة</label>
              <select id="s-dn" className={input} value={s.docNumberPosition ?? "header-end"} onChange={(e) => setStyle("docNumberPosition", e.target.value)}>
                {DOC_NUMBER_POSITIONS.map((p) => <option key={p} value={p}>{DOCNUM_LABELS[p]}</option>)}
              </select></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={s.alternatingRows ?? false} onChange={(e) => setStyle("alternatingRows", e.target.checked)} /> تلوين الصفوف بالتناوب</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={s.showPageNumbers ?? false} onChange={(e) => setStyle("showPageNumbers", e.target.checked)} /> ترقيم الصفحات</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={s.showPrintDate ?? true} onChange={(e) => setStyle("showPrintDate", e.target.checked)} /> تاريخ الطباعة</label>
          </div>
        </fieldset>

        <fieldset className="rounded-lg border border-sand-200 p-3">
          <legend className="px-1 text-sm font-bold text-brand-900">التوقيع والاعتماد</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className={label} htmlFor="g-sl">تسمية التوقيع</label><input id="g-sl" className={input} value={sig.signatureLabel ?? ""} onChange={(e) => setSig("signatureLabel", e.target.value)} maxLength={120} /></div>
            <div><label className={label} htmlFor="g-al">تسمية الاعتماد</label><input id="g-al" className={input} value={sig.approvalLabel ?? ""} onChange={(e) => setSig("approvalLabel", e.target.value)} maxLength={120} /></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={sig.showSignature ?? false} onChange={(e) => setSig("showSignature", e.target.checked)} /> إظهار التوقيع</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={sig.showStamp ?? false} onChange={(e) => setSig("showStamp", e.target.checked)} /> إظهار الاعتماد</label>
          </div>
        </fieldset>

        <fieldset className="rounded-lg border border-sand-200 p-3" data-testid="sections-editor">
          <legend className="px-1 text-sm font-bold text-brand-900">أقسام الوثيقة ({DOC_SECTIONS.length})</legend>
          <p className="mb-2 text-xs text-gray-400">
            رتّب الأقسام وأظهرها أو أخفها، واكتب عنواناً للأقسام التي تقبل عنواناً. المعاينة تتغيّر فوراً.
          </p>
          <ul className="space-y-2">
            {sections.map((s, i) => (
              <li
                key={s.key}
                data-testid={`section-row-${s.key}`}
                className="flex flex-wrap items-center gap-2 rounded-lg bg-sand-50 p-2"
              >
                <span className="w-6 shrink-0 text-center text-xs tabular-nums text-gray-400">{i + 1}</span>
                <label className="flex min-w-0 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    aria-label={`إظهار قسم ${s.def.label}`}
                    checked={s.visible}
                    onChange={(e) => writeSections(sections.map((x) => (x.key === s.key ? { ...x, visible: e.target.checked } : x)))}
                  />
                  <span className="font-medium">{s.def.label}</span>
                </label>
                {s.def.renamable ? (
                  <input
                    className="min-h-11 w-full min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0"
                    placeholder="عنوان القسم (اختياري)"
                    aria-label={`عنوان قسم ${s.def.label}`}
                    maxLength={120}
                    value={s.label ?? ""}
                    onChange={(e) => writeSections(sections.map((x) => (x.key === s.key ? { ...x, label: e.target.value } : x)))}
                  />
                ) : (
                  <span className="min-w-0 flex-1 text-xs text-gray-400">{s.def.hint}</span>
                )}
                <span className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    title="تحريك لأعلى"
                    aria-label={`تحريك قسم ${s.def.label} لأعلى`}
                    disabled={i === 0}
                    onClick={() => writeSections(move(sections, i, -1))}
                    className="min-h-11 min-w-11 rounded border border-sand-200 bg-white px-2 text-sm disabled:opacity-30 lg:min-h-8 lg:min-w-8"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    title="تحريك لأسفل"
                    aria-label={`تحريك قسم ${s.def.label} لأسفل`}
                    disabled={i === sections.length - 1}
                    onClick={() => writeSections(move(sections, i, 1))}
                    className="min-h-11 min-w-11 rounded border border-sand-200 bg-white px-2 text-sm disabled:opacity-30 lg:min-h-8 lg:min-w-8"
                  >
                    ▼
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </fieldset>

        <fieldset className="rounded-lg border border-sand-200 p-3" data-testid="columns-editor">
          <legend className="px-1 text-sm font-bold text-brand-900">أعمدة الجدول ({availableColumns.length})</legend>
          {availableColumns.length === 0 ? (
            <p className="text-xs text-gray-500">
              هذا النوع لا يحتوي جدولاً — لا أعمدة تُحرَّر فيه.
            </p>
          ) : (
            <>
              <p className="mb-2 text-xs text-gray-400">
                رتّب الأعمدة وأظهرها أو أخفها وأعد تسميتها واضبط عرضها بالنسبة المئوية (5–100). اتركه فارغاً للعرض التلقائي.
              </p>
              <ul className="space-y-2">
                {columns.map((c, i) => (
                  <li
                    key={c.key}
                    data-testid={`column-row-${c.key}`}
                    className="flex flex-wrap items-center gap-2 rounded-lg bg-sand-50 p-2"
                  >
                    <span className="w-6 shrink-0 text-center text-xs tabular-nums text-gray-400">{i + 1}</span>
                    <input
                      type="checkbox"
                      aria-label={`إظهار عمود ${availableColumns.find((d) => d.key === c.key)?.label ?? c.key}`}
                      checked={c.visible}
                      onChange={(e) => writeColumns(columns.map((x) => (x.key === c.key ? { ...x, visible: e.target.checked } : x)))}
                    />
                    <input
                      className="min-h-11 w-full min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0"
                      aria-label={`تسمية عمود ${availableColumns.find((d) => d.key === c.key)?.label ?? c.key}`}
                      maxLength={120}
                      value={c.label}
                      onChange={(e) => writeColumns(columns.map((x) => (x.key === c.key ? { ...x, label: e.target.value } : x)))}
                    />
                    <input
                      type="number"
                      min={5}
                      max={100}
                      placeholder="تلقائي"
                      aria-label={`عرض عمود ${availableColumns.find((d) => d.key === c.key)?.label ?? c.key} بالنسبة المئوية`}
                      className="min-h-11 w-20 min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:w-24 lg:min-h-0"
                      value={c.width ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        const width = raw === "" ? null : Math.min(100, Math.max(5, Number(raw)));
                        writeColumns(columns.map((x) => (x.key === c.key ? { ...x, width: Number.isFinite(width as number) ? width : null } : x)));
                      }}
                    />
                    <span className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        title="تحريك لأعلى"
                        aria-label={`تحريك عمود ${availableColumns.find((d) => d.key === c.key)?.label ?? c.key} لأعلى`}
                        disabled={i === 0}
                        onClick={() => writeColumns(move(columns, i, -1))}
                        className="min-h-11 min-w-11 rounded border border-sand-200 bg-white px-2 text-sm disabled:opacity-30 lg:min-h-8 lg:min-w-8"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        title="تحريك لأسفل"
                        aria-label={`تحريك عمود ${availableColumns.find((d) => d.key === c.key)?.label ?? c.key} لأسفل`}
                        disabled={i === columns.length - 1}
                        onClick={() => writeColumns(move(columns, i, 1))}
                        className="min-h-11 min-w-11 rounded border border-sand-200 bg-white px-2 text-sm disabled:opacity-30 lg:min-h-8 lg:min-w-8"
                      >
                        ▼
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </fieldset>

        <details className="rounded-lg border border-sand-200 p-3">
          <summary className="cursor-pointer text-sm font-bold text-brand-900">
            العناصر النائبة المتاحة ({placeholders.length})
          </summary>
          <p className="mt-2 text-xs text-gray-500">انسخ العنصر وضعه داخل أي نص أعلاه. العنصر غير المذكور هنا يُرفض عند الحفظ.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {placeholders.map((p) => (
              <code key={p.key} className="rounded bg-sand-100 px-2 py-0.5 text-xs" title={p.label}>{`{{${p.key}}}`}</code>
            ))}
          </div>
        </details>

        <div className="flex flex-wrap items-center gap-2">
          <input name="changeNote" placeholder="ملاحظة التغيير (اختيارية)" maxLength={300} className="min-h-11 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm lg:min-h-0" />
          <SubmitButton>حفظ</SubmitButton>
          <button type="button" onClick={() => setShowPreview((v) => !v)} className="min-h-11 rounded-lg border border-sand-200 px-3 py-2 text-sm text-gray-700 hover:bg-sand-100 lg:min-h-0">
            {showPreview ? "إخفاء المعاينة" : "إظهار المعاينة"}
          </button>
        </div>
        <p className="text-xs text-gray-400">
          الحفظ ينشئ مسودة. الوثائق الصادرة سابقاً لا تتغيّر أبداً — لكل وثيقة لقطتها المجمّدة.
        </p>
      </form>

      {showPreview && (
        <div data-testid="template-preview">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-gray-600">
              {recordPreview ? "المعاينة (سجل حقيقي)" : "المعاينة (بيانات نموذجية)"}
            </h3>
            <span className="flex flex-wrap items-center gap-3">
              {/* مخرجات المعاينة تُبنى من **النسخة المحفوظة** لا من تعديل غير محفوظ —
                  احفظ أولاً ثم صدّر، فلا يُصدَّر شيء لا يوجد له سجل. */}
              <a
                href={`/api/templates/preview?template=${templateId}&format=pdf${recordPreview && recordId ? `&record=${recordId}` : ""}`}
                target="_blank"
                rel="noopener"
                className="text-xs text-gray-600 hover:underline"
              >
                معاينة PDF
              </a>
              <a
                href={`/api/templates/preview?template=${templateId}&format=docx${recordPreview && recordId ? `&record=${recordId}` : ""}`}
                className="text-xs text-gray-600 hover:underline"
              >
                معاينة Word
              </a>
              {recordPreview && (
                <button
                  type="button"
                  onClick={() => {
                    setRecordPreview(null);
                    setRecordId("");
                  }}
                  className="text-xs text-gray-600 hover:underline"
                >
                  العودة إلى البيانات النموذجية
                </button>
              )}
            </span>
          </div>

          {/* اختيار سجل حقيقي (§E4) — لا يُصدر وثيقة ولا يُعدّل السجل */}
          <div className="mb-2 rounded-lg border border-sand-200 bg-sand-50 p-2" data-testid="record-preview-picker">
            {recordDenied ? (
              <p className="text-xs text-gray-600">
                المعاينة بسجل حقيقي تتطلب صلاحية قراءة سجلات هذا النوع — المعاينة الحالية ببيانات نموذجية.
              </p>
            ) : recordPickerLabel === null ? (
              <p className="text-xs text-gray-600">
                لا سجلات لهذا النوع في المنصة — المعاينة ببيانات نموذجية آمنة.
              </p>
            ) : recordOptions.length === 0 ? (
              <p className="text-xs text-gray-600">
                لا يوجد سجل مناسب بعد — المعاينة ببيانات نموذجية آمنة حتى يُسجَّل أول سجل.
              </p>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1">
                  <label htmlFor="rec-pick" className="mb-1 block text-xs text-gray-500">{recordPickerLabel}</label>
                  <select
                    id="rec-pick"
                    value={recordId}
                    onChange={(e) => setRecordId(e.target.value)}
                    className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0"
                  >
                    <option value="">— بيانات نموذجية —</option>
                    {recordOptions.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  disabled={!recordId || recordPending}
                  onClick={() =>
                    startRecordPreview(async () => {
                      setRecordError(null);
                      const res = await previewWithRecordAction(templateId, recordId, JSON.stringify(config));
                      if ("error" in res) {
                        setRecordPreview(null);
                        setRecordError(res.error);
                      } else {
                        setRecordPreview(res);
                      }
                    })
                  }
                  className="min-h-11 rounded-lg border border-sand-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-sand-100 disabled:opacity-50 lg:min-h-0"
                >
                  {recordPending ? "جارٍ…" : "معاينة بسجل حقيقي"}
                </button>
              </div>
            )}
            {recordError && <p role="alert" className="mt-2 text-xs text-red-700">{recordError}</p>}
          </div>

          {recordPreview && (
            <div role="status" className="mb-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              <span className="font-bold">معاينة فقط —</span> لم تصدر وثيقة، ولم تُنشأ لقطة مجمّدة، ولم يتغيّر السجل:{" "}
              <span className="font-medium">{recordPreview.recordLabel}</span>
            </div>
          )}

          {/* المعاينة معزولة في إطار بلا نصوص برمجية: `sandbox` فارغ يمنع تنفيذ أي شيء
              حتى لو تسرّب محتوى غير متوقع — دفاع بالعمق فوق التهريب. */}
          <iframe
            title="معاينة القالب"
            sandbox=""
            srcDoc={recordPreview ? recordPreview.html : previewHtml}
            className="h-[70vh] w-full rounded-xl border border-sand-200 bg-white"
          />
        </div>
      )}
    </div>
  );
}

/** استيراد إعداد قالب مُتحقَّق منه (§E6) */
export function ImportConfigForm({ templateId }: { templateId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(importTemplateConfigAction.bind(null, templateId), null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);
  // مرجع تفريغ الحقول بعد النجاح — يُستدعى دائماً (قواعد الخطّافات)
  const formRef = useResetOnSuccess(state);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="text-xs text-gray-600 hover:underline">
        {open ? "إغلاق الاستيراد" : "استيراد إعداد"}
      </button>
      {open && (
        <form ref={formRef} action={formAction} className="mt-2 space-y-2">
          {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
          {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
          <textarea name="payload" rows={4} placeholder="ألصق إعداد القالب (JSON)" className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs" />
          <p className="text-xs text-gray-400">يُرفض أي إعداد غير متوافق أو يحوي محتوى غير آمن. يُنشأ كمسودة لا كنسخة منشورة.</p>
          <SubmitButton variant="secondary">استيراد</SubmitButton>
        </form>
      )}
    </div>
  );
}

/** تصدير إعداد القالب الحالي (§E6) — نسخ إلى الحافظة */
export function ExportConfigButton({ config, label }: { config: TemplateConfig; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="text-xs text-gray-600 hover:underline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "نُسخ ✓" : `تصدير إعداد ${label}`}
    </button>
  );
}

export { DOC_TYPE_LABELS };

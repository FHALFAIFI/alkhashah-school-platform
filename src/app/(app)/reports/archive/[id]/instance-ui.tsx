"use client";

import { useActionState, useEffect, useState } from "react";
import { SubmitButton } from "@/components/ui";
import { useRefreshOnSuccess, useVerifiedRefresh } from "@/components/form-reset";
import {
  updateInstanceAction,
  deleteDraftAction,
  copyInstanceAction,
  newVersionAction,
  finalizeInstanceAction,
  archiveInstanceAction,
  unarchiveInstanceAction,
  generateOutputsAction,
  uploadSignedCopyAction,
  type ActionState,
} from "../actions";

/**
 * مكوّنات العميل لصفحة التقرير المحفوظ (v2.6 §A/§B/§I).
 *
 * D-053: كل نموذج يملك نتيجة `useActionState` يستدعي `useRefreshOnSuccess` — لا إبطال
 * مسارات من الخادم. مؤشر التوليد الخلفي يحدّث الصفحة دورياً ما دامت مهمة نشطة (§I).
 */

function Feedback({ state }: { state: ActionState }) {
  if (!state) return null;
  if (state.error) return <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-800">{state.error}</p>;
  if (state.success) return <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800">{state.success}</p>;
  return null;
}

/** حفظ إعدادات المسودة: العنوان والفترة والقالب وترتيب الأقسام — يحمل المرشّحات من العنوان */
export function DraftSettingsForm({
  instanceId,
  typeKey,
  reportKey,
  query,
  title,
  periodFrom,
  periodTo,
  templateKey,
  showEmpty,
  sections,
  hiddenSections,
  templates,
  identityOverrides,
  outputFormats,
}: {
  instanceId: string;
  typeKey: string;
  reportKey: string;
  query: string;
  title: string;
  periodFrom: string | null;
  periodTo: string | null;
  templateKey: string;
  showEmpty: boolean;
  sections: { key: string; label: string }[];
  hiddenSections: string[];
  templates: { key: string; label: string }[];
  identityOverrides: Record<string, string>;
  outputFormats: string[];
}) {
  const action = updateInstanceAction.bind(null, instanceId);
  const [state, formAction] = useActionState(action, null);
  useRefreshOnSuccess(state);
  const [order, setOrder] = useState(sections.map((s) => s.key));
  const [hidden, setHidden] = useState(new Set(hiddenSections));

  const move = (key: string, dir: -1 | 1) => {
    setOrder((prev) => {
      const i = prev.indexOf(key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const labelOf = (key: string) => sections.find((s) => s.key === key)?.label ?? key;

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="typeKey" value={typeKey} />
      <input type="hidden" name="reportKey" value={reportKey} />
      <input type="hidden" name="query" value={query} />
      {order.map((key) => (
        <input key={key} type="hidden" name="sectionOrder" value={key} />
      ))}
      {[...hidden].map((key) => (
        <input key={key} type="hidden" name="hiddenSection" value={key} />
      ))}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="title" className="mb-1 block text-sm font-medium text-gray-700">
            عنوان التقرير الكامل
          </label>
          <input
            id="title"
            name="title"
            defaultValue={title}
            maxLength={200}
            className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm lg:min-h-0"
          />
          <p className="mt-1 text-xs text-gray-400">يظهر في الأرشيف وفي اسم الملف المولَّد: «العنوان - تاريخ الإنشاء»</p>
        </div>
        <div>
          <label htmlFor="templateKey" className="mb-1 block text-sm font-medium text-gray-700">
            القالب
          </label>
          <select
            id="templateKey"
            name="templateKey"
            defaultValue={templateKey}
            className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0"
          >
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
          <input id="periodFrom" name="periodFrom" type="date" defaultValue={periodFrom ?? ""} className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm lg:min-h-0" />
        </div>
        <div>
          <label htmlFor="periodTo" className="mb-1 block text-sm font-medium text-gray-700">
            الفترة إلى
          </label>
          <input id="periodTo" name="periodTo" type="date" defaultValue={periodTo ?? ""} className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm lg:min-h-0" />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" name="showEmpty" value="1" defaultChecked={showEmpty} />
        إظهار الحقول والأقسام الفارغة بدل إخفائها التلقائي
      </label>

      <fieldset>
        <legend className="mb-1 text-sm font-medium text-gray-700">صيغ الإخراج المطلوبة</legend>
        <div className="flex flex-wrap gap-4 text-sm text-gray-700">
          {[
            ["pdf", "PDF"],
            ["docx", "Word"],
            ["xlsx", "Excel"],
          ].map(([value, label]) => (
            <label key={value} className="flex items-center gap-1">
              <input type="checkbox" name="outputFormat" value={value} defaultChecked={outputFormats.includes(value)} />
              {label}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-gray-400">هي وحدها ما يُولَّد بعد الاعتماد، وتدخل حزمة ZIP</p>
      </fieldset>

      {sections.length > 1 && (
        <div>
          <p className="mb-1 text-sm font-medium text-gray-700">ترتيب الأقسام وإظهارها</p>
          <ul className="space-y-1">
            {order.map((key, i) => (
              <li key={key} className="flex items-center gap-2 rounded-lg border border-sand-200 bg-sand-50 px-2 py-1 text-sm">
                <span className="flex-1">{labelOf(key)}</span>
                <button type="button" className="rounded px-2 py-0.5 text-xs text-gray-600 hover:bg-sand-200 disabled:opacity-30" onClick={() => move(key, -1)} disabled={i === 0} aria-label={`تقديم ${labelOf(key)}`}>
                  ↑
                </button>
                <button type="button" className="rounded px-2 py-0.5 text-xs text-gray-600 hover:bg-sand-200 disabled:opacity-30" onClick={() => move(key, 1)} disabled={i === order.length - 1} aria-label={`تأخير ${labelOf(key)}`}>
                  ↓
                </button>
                <label className="flex items-center gap-1 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={!hidden.has(key)}
                    onChange={(e) => {
                      setHidden((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.delete(key);
                        else next.add(key);
                        return next;
                      });
                    }}
                  />
                  ظاهر
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="rounded-lg border border-sand-200 p-2">
        <summary className="cursor-pointer text-sm font-medium text-gray-700">تجاوزات الهوية لهذا التقرير وحده</summary>
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
          {(
            [
              ["schoolName", "اسم المدرسة أو المجمع"],
              ["principalName", "اسم المدير"],
              ["principalTitle", "المسمى الوظيفي للموقّع"],
              ["academicYear", "العام الدراسي"],
              ["headerNote", "نص الترويسة"],
              ["footerNote", "نص التذييل"],
              ["contactInfo", "بيانات الاتصال"],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <label htmlFor={`identity_${key}`} className="mb-1 block text-xs text-gray-600">
                {label}
              </label>
              <input
                id={`identity_${key}`}
                name={`identity_${key}`}
                defaultValue={identityOverrides[key] ?? ""}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
          ))}
        </div>
        <p className="mt-1 text-xs text-gray-400">التجاوز يخص هذا التقرير — الإعدادات المركزية لا تتغير</p>
      </details>

      <SubmitButton>حفظ المسودة</SubmitButton>
      <Feedback state={state} />
    </form>
  );
}

/** زر إجراء واحد بنموذج مستقل — نمط الأزرار الحاسمة في المنصة */
function ActionForm({
  action,
  label,
  variant = "secondary",
  confirmText,
  confirmField,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  label: string;
  variant?: "primary" | "danger" | "secondary";
  confirmText?: string;
  confirmField?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  useRefreshOnSuccess(state);
  return (
    <form action={formAction} className="inline-block">
      {confirmField && <input type="hidden" name="confirm" value="1" />}
      <SubmitButton variant={variant} confirmText={confirmText}>
        {label}
      </SubmitButton>
      <Feedback state={state} />
    </form>
  );
}

export function DraftActions({ instanceId }: { instanceId: string }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      <ActionForm
        action={finalizeInstanceAction.bind(null, instanceId)}
        label="اعتماد نهائي وترقيم"
        variant="primary"
        confirmField
        confirmText="بعد الاعتماد يُمنح التقرير رقماً وتتجمد لقطته ولا يُعدَّل ولا يُحذف. أتريد الاعتماد؟"
      />
      <ActionForm action={copyInstanceAction.bind(null, instanceId)} label="نسخ إلى مسودة جديدة" />
      <ActionForm
        action={deleteDraftAction.bind(null, instanceId)}
        label="حذف المسودة"
        variant="danger"
        confirmField
        confirmText="حذف المسودة نهائي — التقارير المعتمدة وحدها محفوظة دائماً. أتريد الحذف؟"
      />
    </div>
  );
}

export function FinalActions({ instanceId, archived }: { instanceId: string; archived: boolean }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      <ActionForm action={newVersionAction.bind(null, instanceId)} label="نسخة جديدة (برقم جديد)" variant="primary" />
      <ActionForm action={copyInstanceAction.bind(null, instanceId)} label="نسخ إلى مسودة" />
      <ActionForm action={generateOutputsAction.bind(null, instanceId)} label="توليد المخرجات" />
      {archived ? (
        <ActionForm action={unarchiveInstanceAction.bind(null, instanceId)} label="استعادة من الأرشيف" />
      ) : (
        <ActionForm
          action={archiveInstanceAction.bind(null, instanceId)}
          label="أرشفة"
          confirmText="الأرشفة تحويل حالة فقط — المحتوى المجمّد لا يتغير. أتريد الأرشفة؟"
        />
      )}
    </div>
  );
}

/** إعادة المحاولة بعد فشل التوليد (§I) */
export function RetryGenerationButton({ instanceId }: { instanceId: string }) {
  return <ActionForm action={generateOutputsAction.bind(null, instanceId)} label="إعادة المحاولة" variant="primary" />;
}

/** رفع النسخة الموقّعة بعد التوقيع الخارجي (§B) */
export function SignedCopyForm({ instanceId, hasSigned }: { instanceId: string; hasSigned: boolean }) {
  const [state, formAction] = useActionState(uploadSignedCopyAction.bind(null, instanceId), null);
  useRefreshOnSuccess(state);
  return (
    <form action={formAction} className="space-y-2">
      <label htmlFor="signedCopy" className="block text-sm font-medium text-gray-700">
        {hasSigned ? "استبدال النسخة الموقّعة" : "رفع النسخة الموقّعة"}
      </label>
      <input id="signedCopy" name="signedCopy" type="file" accept=".pdf,.jpg,.jpeg,.png" className="block w-full text-sm" />
      <SubmitButton variant="secondary">حفظ النسخة الموقّعة</SubmitButton>
      <Feedback state={state} />
    </form>
  );
}

/**
 * مؤشر التوليد الخلفي (§I — أُعيد بناؤه في D-069).
 *
 * كان يستطلع بتحديث كامل للصفحة كل أربع ثوانٍ، وكل تحديث يُطلق إعادة جلب الجلب المسبق
 * لكل روابط الصفحة — عشرات طلبات RSC تتزاحم على ستّ وصلات HTTP/1.1 فتُجهَض وتخنق التحديث
 * الذي يحمل الحالة المرئية. الآن:
 *  • الاستطلاع الدوري يقرأ JSON خفيفاً من `/api/reports/instances/[id]/job` — لا تحديث كاملاً؛
 *  • لا تداخل بين استطلاعين: التالي يُجدول بعد اكتمال السابق فقط؛
 *  • عند الوصول إلى حالة نهائية: تحديث كامل **واحد**، وتُعرض النتيجة هنا من حمولة
 *    الاستطلاع نفسها — روابط التنزيل عند الاكتمال والسبب العربي عند الفشل — فلا تتوقف
 *    رؤية النتيجة على وصول التحديث؛
 *  • مهلة صريحة وحالة خطأ صريحة، وتنظيف كامل عند مغادرة الصفحة.
 */
type JobPoll = {
  active: boolean;
  job: { status: string; attempt: number; error: string | null } | null;
  outputs: { format: string; size: number | null }[];
};

/** أقصى مدة متابعة — أطول من مهلة انقطاع المهمة (٥ دقائق) فلا نعلن المهلة قبل الخادم */
const WATCH_TIMEOUT_MS = 6 * 60 * 1000;
const POLL_INTERVAL_MS = 2500;
const MAX_CONSECUTIVE_POLL_FAILURES = 3;

const OUTPUT_LABELS: Record<string, string> = { pdf: "PDF", docx: "Word", xlsx: "Excel", zip: "حزمة ZIP" };

export function JobWatcher({ instanceId, active }: { instanceId: string; active: boolean }) {
  const verifiedRefresh = useVerifiedRefresh();
  const [outcome, setOutcome] = useState<
    | { kind: "done"; outputs: JobPoll["outputs"] }
    | { kind: "failed"; error: string }
    | { kind: "timeout" }
    | { kind: "unreachable" }
    | null
  >(null);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let failures = 0;
    let refreshed = false;
    const startedAt = Date.now();

    const finish = (next: NonNullable<Parameters<typeof setOutcome>[0]>) => {
      if (stopped) return;
      stopped = true;
      setOutcome(next);
      // تحديث نهائي واحد (مُتحقَّق منه — D-069) يُصالح HTML الخادم؛ النتيجة معروضة أعلاه ولو تعثّر
      if (!refreshed) {
        refreshed = true;
        verifiedRefresh();
      }
    };

    const poll = async () => {
      if (stopped) return;
      if (Date.now() - startedAt > WATCH_TIMEOUT_MS) {
        finish({ kind: "timeout" });
        return;
      }
      try {
        const res = await fetch(`/api/reports/instances/${instanceId}/job`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as JobPoll;
        failures = 0;
        if (!data.active) {
          if (data.job?.status === "مكتمل") finish({ kind: "done", outputs: data.outputs });
          else finish({ kind: "failed", error: data.job?.error ?? "انقطع التوليد قبل اكتماله — أعد المحاولة" });
          return;
        }
      } catch {
        if (controller.signal.aborted || stopped) return;
        failures += 1;
        if (failures >= MAX_CONSECUTIVE_POLL_FAILURES) {
          finish({ kind: "unreachable" });
          return;
        }
      }
      // لا تداخل: الاستطلاع التالي يُجدول بعد اكتمال هذا فقط
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [active, instanceId, verifiedRefresh]);

  // الخادم هو الحقيقة حين لا مهمة نشطة في تصييره — وتصييره بعد التحديث النهائي يحل محل هذا
  if (!active || !outcome) return null;
  if (outcome.kind === "done") {
    return (
      <div role="status" className="rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800">
        اكتمل توليد المخرجات.
        {outcome.outputs.length > 0 && (
          <span className="ms-2 inline-flex flex-wrap gap-2">
            {outcome.outputs.map((o) => (
              <a
                key={o.format}
                className="underline"
                href={`/api/reports/instances/${instanceId}/download?format=${o.format}`}
              >
                تنزيل {OUTPUT_LABELS[o.format] ?? o.format.toUpperCase()}
              </a>
            ))}
          </span>
        )}
      </div>
    );
  }
  if (outcome.kind === "failed") {
    return (
      <div role="status" className="space-y-2 rounded-lg bg-red-50 p-2 text-xs text-red-800">
        <p>فشل التوليد — {outcome.error}</p>
        <RetryGenerationButton instanceId={instanceId} />
      </div>
    );
  }
  return (
    <div role="status" className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
      {outcome.kind === "timeout"
        ? "طالت متابعة التوليد أكثر من المتوقع — أعد فتح الصفحة للاطلاع على الحالة، وإن ظل التوليد متعثراً استعمل «توليد المخرجات» من جديد."
        : "تعذّر الاتصال لمتابعة حالة التوليد — أعد فتح الصفحة للاطلاع على الحالة."}
    </div>
  );
}

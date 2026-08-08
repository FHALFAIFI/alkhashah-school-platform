"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SubmitButton } from "@/components/ui";
import { useRefreshOnSuccess } from "@/components/form-reset";
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
 * مؤشر التوليد الخلفي (§I): ما دامت مهمة نشطة تُحدَّث الصفحة دورياً حتى يظهر اكتمالها
 * أو فشلها بسببه — بلا تجميد للصفحة وبلا إعادة يدوية.
 */
export function JobWatcher({ active }: { active: boolean }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!active) return;
    timer.current = setInterval(() => router.refresh(), 4000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [active, router]);
  return null;
}

"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui";
import { useRefreshOnSuccess } from "@/components/form-reset";
import {
  createStyleAction,
  updateStyleAction,
  archiveStyleAction,
  restoreStyleAction,
  setDefaultTemplateAction,
  type ActionState,
} from "./actions";

/**
 * واجهة قوالب الإخراج (v2.6 §E — D-058): نسخ مخصصة من قوالب أساسية محمية، بحقول معدودة
 * لا مصمم حر. D-053: كل نموذج يحدّث نفسه بعد استقرار النتيجة.
 */

function Feedback({ state }: { state: ActionState }) {
  if (!state) return null;
  if (state.error) return <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-800">{state.error}</p>;
  if (state.success) return <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800">{state.success}</p>;
  return null;
}

const field = "min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm lg:min-h-0";
const label = "mb-1 block text-xs font-medium text-gray-600";

export function CreateCopyForm({ baseKey, baseLabel }: { baseKey: string; baseLabel: string }) {
  const [state, formAction] = useActionState(createStyleAction, null);
  useRefreshOnSuccess(state);
  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="baseKey" value={baseKey} />
      <input type="hidden" name="name" value={`${baseLabel} — نسخة مخصصة`} />
      <SubmitButton variant="secondary">إنشاء نسخة مخصصة</SubmitButton>
      <Feedback state={state} />
    </form>
  );
}

export type StyleConfigShape = {
  primaryColor: string;
  accentColor: string;
  showIdentity: boolean;
  showLogos: boolean;
  cover: string;
  toc: string;
  approvalBox: boolean;
  headerText: string;
  footerText: string;
  density: string;
};

export function EditCopyForm({
  templateId,
  name,
  config,
}: {
  templateId: string;
  name: string;
  config: StyleConfigShape;
}) {
  const [state, formAction] = useActionState(updateStyleAction.bind(null, templateId), null);
  useRefreshOnSuccess(state);
  return (
    <form action={formAction} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="md:col-span-3">
          <label className={label} htmlFor={`name-${templateId}`}>اسم النسخة</label>
          <input id={`name-${templateId}`} name="name" defaultValue={name} maxLength={80} className={field} />
        </div>
        <div>
          <label className={label} htmlFor={`primary-${templateId}`}>اللون الأساسي</label>
          <input id={`primary-${templateId}`} name="primaryColor" defaultValue={config.primaryColor} dir="ltr" className={field} />
        </div>
        <div>
          <label className={label} htmlFor={`accent-${templateId}`}>لون التمييز</label>
          <input id={`accent-${templateId}`} name="accentColor" defaultValue={config.accentColor} dir="ltr" className={field} />
        </div>
        <div>
          <label className={label} htmlFor={`density-${templateId}`}>كثافة الجدول</label>
          <select id={`density-${templateId}`} name="density" defaultValue={config.density} className={field}>
            <option value="عادي">عادي</option>
            <option value="مضغوط">مضغوط</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor={`cover-${templateId}`}>الغلاف</label>
          <select id={`cover-${templateId}`} name="cover" defaultValue={config.cover} className={field}>
            <option value="تلقائي">تلقائي (للتقارير الطويلة)</option>
            <option value="نعم">دائماً</option>
            <option value="لا">أبداً</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor={`toc-${templateId}`}>فهرس المحتويات</label>
          <select id={`toc-${templateId}`} name="toc" defaultValue={config.toc} className={field}>
            <option value="تلقائي">تلقائي</option>
            <option value="نعم">دائماً</option>
            <option value="لا">أبداً</option>
          </select>
        </div>
        <div className="flex items-end gap-4 text-sm text-gray-700">
          <label className="flex items-center gap-1">
            <input type="checkbox" name="showIdentity" value="1" defaultChecked={config.showIdentity} /> الهوية
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" name="showLogos" value="1" defaultChecked={config.showLogos} /> الشعارات
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" name="approvalBox" value="1" defaultChecked={config.approvalBox} /> مربع الاعتماد
          </label>
        </div>
        <div className="md:col-span-3">
          <label className={label} htmlFor={`header-${templateId}`}>نص الترويسة</label>
          <input id={`header-${templateId}`} name="headerText" defaultValue={config.headerText} maxLength={300} className={field} />
        </div>
        <div className="md:col-span-3">
          <label className={label} htmlFor={`footer-${templateId}`}>نص التذييل</label>
          <input id={`footer-${templateId}`} name="footerText" defaultValue={config.footerText} maxLength={300} className={field} />
        </div>
      </div>
      <SubmitButton>حفظ النسخة</SubmitButton>
      <Feedback state={state} />
    </form>
  );
}

export function ArchiveRestoreButtons({ templateId, archived }: { templateId: string; archived: boolean }) {
  const [archiveState, archiveAction] = useActionState(archiveStyleAction.bind(null, templateId), null);
  const [restoreState, restoreAction] = useActionState(restoreStyleAction.bind(null, templateId), null);
  useRefreshOnSuccess(archiveState);
  useRefreshOnSuccess(restoreState);
  return archived ? (
    <form action={restoreAction} className="inline-block">
      <SubmitButton variant="secondary">استعادة</SubmitButton>
      <Feedback state={restoreState} />
    </form>
  ) : (
    <form action={archiveAction} className="inline-block">
      <input type="hidden" name="confirm" value="1" />
      <SubmitButton variant="secondary" confirmText="الأرشفة تُخفي القالب من قوائم الاختيار — التقارير المعتمدة تحمل إعدادها مجمّداً فلا تتأثر. أتريد الأرشفة؟">
        أرشفة
      </SubmitButton>
      <Feedback state={archiveState} />
    </form>
  );
}

export function DefaultTemplateForm({
  typeKey,
  typeLabel,
  current,
  choices,
}: {
  typeKey: string;
  typeLabel: string;
  current: string;
  choices: { key: string; label: string }[];
}) {
  const [state, formAction] = useActionState(setDefaultTemplateAction.bind(null, typeKey), null);
  useRefreshOnSuccess(state);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="min-w-60 flex-1">
        <label className={label} htmlFor={`default-${typeKey}`}>{typeLabel}</label>
        <select id={`default-${typeKey}`} name="templateKey" defaultValue={current} className={field}>
          {choices.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <SubmitButton variant="secondary">حفظ الافتراضي</SubmitButton>
      <Feedback state={state} />
    </form>
  );
}

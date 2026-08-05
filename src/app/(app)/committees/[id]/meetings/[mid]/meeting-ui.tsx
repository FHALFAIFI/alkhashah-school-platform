"use client";

import { useActionState, useState, useTransition } from "react";
import {
  updateMeetingAction, addOutcomeAction, uploadSignedMinutesAction, completeMeetingAction,
  addMeetingAttachmentAction, deleteMeetingAttachmentAction,
  type ActionState,
} from "../../../actions";
import { MEETING_ATTACHMENT_CATEGORIES } from "@/lib/committees/constants";
import { Field, TextArea, SubmitButton } from "@/components/ui";
import { useResetOnSuccess, useRefreshAfterTransition } from "@/components/form-reset";
import { useRefreshOnSuccess } from "@/components/form-reset";

type MeetingType = { id: string; nameAr: string };

export function MeetingEditForm({
  meetingId,
  defaults,
  types,
  currentTypeId,
}: {
  meetingId: string;
  defaults: { title: string; meetingDate: string; location: string; agenda: string; discussion: string };
  types: MeetingType[];
  currentTypeId: string | null;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateMeetingAction.bind(null, meetingId), null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);
  return (
    <form action={formAction} className="space-y-3">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">تم الحفظ</div>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="العنوان" name="title" defaultValue={defaults.title} />
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">نوع الاجتماع</label>
          <select name="typeId" defaultValue={currentTypeId ?? ""} className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0">
            <option value="">— اختر النوع —</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>{t.nameAr}</option>
            ))}
          </select>
        </div>
        <Field label="التاريخ" name="meetingDate" type="date" defaultValue={defaults.meetingDate} />
        <Field label="المكان" name="location" defaultValue={defaults.location} />
      </div>
      <TextArea label="جدول الأعمال (بند في كل سطر)" name="agenda" defaultValue={defaults.agenda} rows={4} />
      <TextArea label="المناقشات" name="discussion" defaultValue={defaults.discussion} rows={5} />
      <SubmitButton>حفظ</SubmitButton>
    </form>
  );
}

/** إضافة مرفق خاص للاجتماع: عنوان، وصف، فئة، ملف. (ليست حضوراً — لا حضور ولا غياب.) */
export function MeetingAttachmentForm({ meetingId }: { meetingId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(addMeetingAttachmentAction.bind(null, meetingId), null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);
  // مرجع تفريغ الحقول بعد النجاح — يُستدعى دائماً (قواعد الخطّافات)
  const formRef = useResetOnSuccess(state);
  return (
    <form ref={formRef} action={formAction} className="mt-3 space-y-3 rounded-lg bg-sand-50 p-3">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="عنوان المرفق" name="title" />
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">فئة المرفق</label>
          <select name="category" className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0">
            {MEETING_ATTACHMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>
      <Field label="وصف مختصر" name="description" />
      <input name="file" type="file" required className="w-full rounded-lg border border-dashed border-gray-300 p-3 text-sm" />
      <SubmitButton variant="secondary">إضافة المرفق</SubmitButton>
    </form>
  );
}

/** حذف مرفق اجتماع */
export function DeleteAttachmentButton({ attachmentId }: { attachmentId: string }) {
  const [pending, startTransition] = useTransition();
  // D-053: التحديث بعد اكتمال الانتقال — الإجراء لم يعد يُبطل أي مسار
  useRefreshAfterTransition(pending);
  const [error, setError] = useState<string | null>(null);
  return (
    <span>
      <button
        disabled={pending}
        onClick={() => startTransition(async () => { const r = await deleteMeetingAttachmentAction(attachmentId); if (r?.error) setError(r.error); })}
        className="text-xs text-red-500 hover:underline"
      >
        حذف
      </button>
      {error && <span className="ms-1 text-xs text-red-600">{error}</span>}
    </span>
  );
}

export function OutcomeForm({ meetingId, people }: { meetingId: string; people: { id: string; fullName: string }[] }) {
  const [state, formAction] = useActionState<ActionState, FormData>(addOutcomeAction.bind(null, meetingId), null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);
  const [type, setType] = useState("قرار");
  return (
    <form action={formAction} className="mt-3 space-y-3 rounded-lg bg-sand-50 p-3">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">النوع</label>
          <select name="outcomeType" value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="قرار">قرار — ينشئ إجراءً إلزامياً</option>
            <option value="توصية">توصية</option>
            <option value="ملاحظة">ملاحظة</option>
          </select>
        </div>
        <div className="min-w-64 flex-1">
          <Field label="النص" name="text" />
        </div>
      </div>
      {(type === "قرار" || type === "توصية") && (
        <div className="flex flex-wrap items-end gap-3">
          {type === "توصية" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="createTask" />
              إنشاء إجراء اختياري للتوصية
            </label>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">المكلف</label>
            <select name="ownerPersonId" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="">— غير محدد —</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.fullName}</option>
              ))}
            </select>
          </div>
          <div>
            <Field label="موعد التنفيذ" name="dueDate" type="date" />
          </div>
        </div>
      )}
      <SubmitButton variant="secondary">تسجيل النتيجة</SubmitButton>
    </form>
  );
}

export function SignedMinutesUpload({ meetingId }: { meetingId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(uploadSignedMinutesAction.bind(null, meetingId), null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      {state?.error && <div role="alert" className="w-full rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      <div className="min-w-64 flex-1">
        <label className="mb-1 block text-sm font-medium text-gray-700">رفع المحضر الموقع (الرئيس والمقرر)</label>
        <input name="file" type="file" accept="application/pdf,image/*" required className="w-full rounded-lg border border-dashed border-gray-300 p-3 text-sm" />
      </div>
      <SubmitButton variant="secondary">رفع</SubmitButton>
    </form>
  );
}

export function CompleteMeetingButton({ meetingId, disabled }: { meetingId: string; disabled: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // D-053: التحديث بعد اكتمال الانتقال — الإجراء لم يعد يُبطل أي مسار
  useRefreshAfterTransition(pending);
  return (
    <div>
      {error && <div role="alert" className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</div>}
      <button
        disabled={disabled || pending}
        onClick={() =>
          startTransition(async () => {
            const res = await completeMeetingAction(meetingId);
            if (res?.error) setError(res.error);
          })
        }
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        اعتماد الاكتمال
      </button>
      {disabled && <p className="mt-1 text-xs text-amber-600">يتطلب رفع المحضر الموقع أولاً</p>}
    </div>
  );
}

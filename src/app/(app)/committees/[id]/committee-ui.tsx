"use client";

import { useActionState, useState, useTransition } from "react";
import {
  addMemberAction, removeMemberAction, approveCommitteeAction, reopenCommitteeAction,
  createMeetingAction, closeCommitteeAction,
  generateAssignmentFormAction, uploadSignedAssignmentAction, type ActionState,
} from "../actions";
import { Field, SubmitButton, TextArea } from "@/components/ui";
import { useRefreshOnSuccess, useRefreshAfterTransition } from "@/components/form-reset";

export function AddMemberForm({
  committeeId,
  people,
  isPlc,
}: {
  committeeId: string;
  people: { id: string; fullName: string; jobTitle: string | null }[];
  isPlc: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(addMemberAction.bind(null, committeeId), null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);
  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-sand-100 pt-3">
      {state?.error && <div role="alert" className="w-full rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      <div className="min-w-56 flex-1">
        <label className="mb-1 block text-sm font-medium text-gray-700">العضو (من منسوبي المدرسة)</label>
        <select name="personId" required className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
          <option value="">— اختر —</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName}{p.jobTitle ? ` — ${p.jobTitle}` : ""}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">العمل في اللجنة</label>
        <select name="role" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
          {(isPlc ? ["قائد", "عضو"] : ["رئيس", "نائب", "مقرر", "عضو"]).map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>
      <div className="w-44">
        <Field label="الصفة (اختياري)" name="position" />
      </div>
      <SubmitButton variant="secondary">إضافة عضو</SubmitButton>
    </form>
  );
}

export function RemoveMemberButton({ memberId }: { memberId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // D-053: التحديث بعد اكتمال الانتقال — الإجراء لم يعد يُبطل أي مسار
  useRefreshAfterTransition(pending);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await removeMemberAction(memberId);
            setError(res?.error ?? null);
          })
        }
        className="text-xs text-red-500 hover:underline"
      >
        إزالة
      </button>
      {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

export function AssignmentFormCard({
  committeeId,
  assignmentPdfFileId,
  signedAssignmentFileId,
  canManage,
}: {
  committeeId: string;
  assignmentPdfFileId: string | null;
  signedAssignmentFileId: string | null;
  canManage: boolean;
}) {
  const hasAssignmentDoc = !!assignmentPdfFileId;
  const hasSignedAssignment = !!signedAssignmentFileId;
  const [notice, setNotice] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [uploadState, uploadAction] = useActionState<ActionState, FormData>(
    uploadSignedAssignmentAction.bind(null, committeeId),
    null,
  );
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(uploadState);
  const [generating, startTransition] = useTransition();
  /*
   * D-065: كان توليد نموذج التكليف ينتهي برسالة يملكها العميل («صدر نموذج التكليف …») بلا
   * تحديث، فلا يظهر رابط «تنزيل نموذج التكليف» — لأنه يُشتق من `assignmentPdfFileId` القادم
   * من الخادم. كان الاختبار يمرّ أحياناً لأن تحديثاً عابراً من لوحة توزيع المهام يسبقه
   * مصادفةً؛ فالعيب قائم والاختبار متذبذب. التحديث الآن بعد انتهاء الانتقال (D-049 قاعدة 3).
   */
  useRefreshAfterTransition(generating);

  return (
    <div className="space-y-2">
      {notice && (
        <div role={notice.kind === "error" ? "alert" : "status"} className={`rounded p-2 text-xs ${notice.kind === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
          {notice.text}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {canManage && (
          <button
            onClick={() =>
              startTransition(async () => {
                setNotice(null);
                const res = await generateAssignmentFormAction(committeeId);
                if (res?.error) setNotice({ kind: "error", text: res.error });
                else if (res?.success) setNotice({ kind: "ok", text: res.success });
              })
            }
            className="min-h-11 rounded-lg border border-sand-200 px-3 py-1.5 text-sm hover:bg-sand-100 lg:min-h-0"
          >
            {hasAssignmentDoc ? "إعادة توليد نموذج التكليف" : "توليد نموذج التكليف"}
          </button>
        )}
        {hasAssignmentDoc && assignmentPdfFileId && (
          <a href={`/api/files/${assignmentPdfFileId}`} className="text-sm text-brand-700 underline">تنزيل نموذج التكليف</a>
        )}
        {hasSignedAssignment && signedAssignmentFileId && (
          <a href={`/api/files/${signedAssignmentFileId}`} className="text-sm text-emerald-700 underline">التكليف الموقّع</a>
        )}
      </div>
      {canManage && hasAssignmentDoc && (
        <form action={uploadAction} className="flex flex-wrap items-end gap-2">
          {uploadState?.error && <div role="alert" className="w-full rounded bg-red-50 p-2 text-xs text-red-700">{uploadState.error}</div>}
          {uploadState?.success && <div role="status" className="w-full rounded bg-emerald-50 p-2 text-xs text-emerald-700">{uploadState.success}</div>}
          <input name="file" type="file" accept="application/pdf,image/*" className="rounded-lg border border-dashed border-gray-300 p-2 text-xs" />
          <SubmitButton variant="secondary">{hasSignedAssignment ? "استبدال التكليف الموقّع" : "رفع التكليف الموقّع"}</SubmitButton>
        </form>
      )}
    </div>
  );
}

export function ApproveCommitteeButton({ committeeId }: { committeeId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // D-053: التحديث بعد اكتمال الانتقال — الإجراء لم يعد يُبطل أي مسار
  useRefreshAfterTransition(pending);
  return (
    <div className="text-end">
      {error && <div role="alert" className="mb-1 rounded bg-red-50 p-2 text-xs text-red-700">{error}</div>}
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await approveCommitteeAction(committeeId);
            if (res?.error) setError(res.error);
          })
        }
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        اعتماد التشكيل
      </button>
    </div>
  );
}

export function ReopenCommitteeForm({ committeeId }: { committeeId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(reopenCommitteeAction.bind(null, committeeId), null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      {state?.error && <span role="alert" className="w-full text-xs text-red-600">{state.error}</span>}
      {state?.success && <span role="status" className="w-full text-xs text-emerald-700">{state.success}</span>}
      <input name="reason" required placeholder="سبب إعادة الفتح (إلزامي)" className="min-w-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
      <SubmitButton variant="secondary">إعادة فتح بسبب موثق</SubmitButton>
    </form>
  );
}

export function NewMeetingForm({ committeeId, types }: { committeeId: string; types: { id: string; nameAr: string }[] }) {
  const [state, formAction] = useActionState<ActionState, FormData>(createMeetingAction.bind(null, committeeId), null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);
  return (
    <form action={formAction} className="mt-3 space-y-3 border-t border-sand-100 pt-3">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Field label="عنوان الاجتماع" name="title" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">نوع الاجتماع</label>
          <select name="typeId" className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0">
            <option value="">— بلا نوع —</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>{t.nameAr}</option>
            ))}
          </select>
        </div>
        <div>
          <Field label="التاريخ" name="meetingDate" type="date" />
        </div>
      </div>
      <TextArea label="جدول الأعمال (بند في كل سطر)" name="agenda" rows={3} />
      <SubmitButton>إنشاء اجتماع</SubmitButton>
    </form>
  );
}

export function CloseCommitteeButton({ committeeId }: { committeeId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // D-053: التحديث بعد اكتمال الانتقال — الإجراء لم يعد يُبطل أي مسار
  useRefreshAfterTransition(pending);
  return (
    <div>
      {error && <span className="me-2 text-xs text-red-600">{error}</span>}
      <button
        disabled={pending}
        onClick={() => {
          if (!confirm("إقفال اللجنة وأرشفتها لنهاية العام؟")) return;
          startTransition(async () => {
            const res = await closeCommitteeAction(committeeId);
            if (res?.error) setError(res.error);
          });
        }}
        className="rounded-lg border border-sand-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-sand-100"
      >
        إقفال وأرشفة
      </button>
    </div>
  );
}

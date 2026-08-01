"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  submitInspectionAction,
  overrideReadinessAction,
  updateRoomAction,
  createIssueAction,
  updateFindingAction,
  closeFindingAction,
  createIssueFromFindingAction,
  createIssuesFromInspectionAction,
  type ActionState,
  type InspectionSubmitState,
} from "../../actions";
import { Field, SubmitButton } from "@/components/ui";

const ROOM_TYPES = [
  "فصل دراسي", "معمل", "مكتب إداري", "غرفة معلمين", "مصادر تعلم", "ممر", "سلم",
  "دورة مياه", "خدمات", "ملعب", "ساحة", "مخرج طوارئ", "بوابة", "مظلة",
];

/** تعديل الحقول البسيطة للغرفة — الاسم والنوع والأبعاد والسعة والملاحظات */
export function RoomEditForm({
  roomId,
  initial,
}: {
  roomId: string;
  initial: { nameAr: string; roomType: string; lengthM: string | null; widthM: string | null; capacity: number | null; notes: string | null };
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateRoomAction.bind(null, roomId), null);
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button id="edit-room" onClick={() => setOpen(true)} className="min-h-11 scroll-mt-20 rounded-lg border border-sand-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-sand-100 lg:min-h-0">
        تعديل بيانات الغرفة
      </button>
    );
  }
  const types = ROOM_TYPES.includes(initial.roomType) ? ROOM_TYPES : [initial.roomType, ...ROOM_TYPES];
  return (
    <form id="edit-room" action={formAction} className="w-full scroll-mt-20 space-y-3 rounded-lg bg-sand-50 p-3">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-sm text-emerald-700">{state.success}</div>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="اسم الغرفة" name="nameAr" defaultValue={initial.nameAr} />
        <div>
          <label htmlFor="roomType" className="mb-1 block text-sm font-medium text-gray-700">النوع</label>
          <select id="roomType" name="roomType" defaultValue={initial.roomType} className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0">
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <Field label="الطول (م)" name="lengthM" type="number" defaultValue={initial.lengthM ?? undefined} dir="ltr" />
        <Field label="العرض (م)" name="widthM" type="number" defaultValue={initial.widthM ?? undefined} dir="ltr" />
        <Field label="السعة" name="capacity" type="number" defaultValue={initial.capacity ?? undefined} dir="ltr" />
        <Field label="ملاحظات" name="notes" defaultValue={initial.notes ?? undefined} />
      </div>
      <div className="flex gap-2">
        <SubmitButton>حفظ</SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className="min-h-11 px-3 text-sm text-gray-500 lg:min-h-0">إغلاق</button>
      </div>
    </form>
  );
}

/** بلاغ صيانة سريع من صفحة الغرفة نفسها — الصورة ملف من الجهاز (يعمل عبر HTTP دون كاميرا) */
export function RoomIssueForm({ roomId, people }: { roomId: string; people: { id: string; label: string }[] }) {
  const [state, formAction] = useActionState<ActionState, FormData>(createIssueAction, null);
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button id="report-issue" onClick={() => setOpen(true)} className="min-h-11 scroll-mt-20 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 lg:min-h-0">
        بلاغ صيانة لهذه الغرفة
      </button>
    );
  }
  return (
    <form id="report-issue" action={formAction} className="w-full scroll-mt-20 space-y-3 rounded-lg bg-sand-50 p-3">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-sm text-emerald-700">{state.success}</div>}
      <input type="hidden" name="roomId" value={roomId} />
      <Field label="عنوان البلاغ" name="title" />
      <Field label="الوصف" name="description" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">الأولوية</label>
          <select name="priority" defaultValue="متوسطة" className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0">
            <option value="عالية">عالية</option>
            <option value="متوسطة">متوسطة</option>
            <option value="منخفضة">منخفضة</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">المكلف بالإصلاح (اختياري)</label>
          <select name="ownerPersonId" className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0">
            <option value="">— بلا تكليف —</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">صورة (اختياري)</label>
          <input name="photo" type="file" accept="image/*" className="w-full text-sm" />
          <p className="mt-1 text-xs text-gray-400">التقط صورة أو اختر ملفاً من الجهاز</p>
        </div>
      </div>
      <div className="flex gap-2">
        <SubmitButton>تسجيل البلاغ</SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className="min-h-11 px-3 text-sm text-gray-500 lg:min-h-0">إغلاق</button>
      </div>
    </form>
  );
}

export function InspectionRunForm({
  roomId,
  templates,
  canCreateIssues,
}: {
  roomId: string;
  templates: { id: string; nameAr: string; items: { key: string; label: string; required: boolean }[] }[];
  /** يملك صلاحية إنشاء بلاغات الصيانة — يظهر له عرض التحويل الفوري (v2.4 §14) */
  canCreateIssues: boolean;
}) {
  const [state, formAction] = useActionState<InspectionSubmitState, FormData>(submitInspectionAction, null);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [open, setOpen] = useState(false);
  const [offerDismissed, setOfferDismissed] = useState(false);
  const template = templates.find((t) => t.id === templateId);

  // v2.4 §14أ: عرض إنشاء البلاغات فور حفظ فحص فيه ملاحظات — يبقى ظاهراً حتى بعد إغلاق النموذج
  const offer =
    !offerDismissed && state?.inspectionId && (state.findingsCount ?? 0) > 0 ? (
      <ConvertFindingsOffer
        inspectionId={state.inspectionId}
        findingsCount={state.findingsCount ?? 0}
        canCreateIssues={canCreateIssues}
        onDismiss={() => setOfferDismissed(true)}
      />
    ) : null;

  if (!open) {
    return (
      <div>
        {offer}
        <button onClick={() => setOpen(true)} className="mb-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">
          تنفيذ فحص جديد
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="mb-4 space-y-3 rounded-lg bg-sand-50 p-3">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      {offer}
      <input type="hidden" name="roomId" value={roomId} />
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">قالب الفحص</label>
        <select
          name="templateId"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.nameAr}</option>
          ))}
        </select>
      </div>
      {template && (
        <div className="space-y-2">
          {template.items.map((item) => (
            <div key={item.key} className="flex flex-wrap items-center gap-3 rounded-lg border border-sand-200 bg-white px-3 py-2 text-sm">
              <span className="min-w-40 flex-1">{item.label}</span>
              <label className="flex items-center gap-1">
                <input type="radio" name={`item_${item.key}`} value="ok" defaultChecked />
                سليم
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" name={`item_${item.key}`} value="not_ok" />
                يحتاج معالجة
              </label>
              <input name={`note_${item.key}`} placeholder="ملاحظة" className="w-40 rounded border border-gray-300 px-2 py-1 text-xs" />
            </div>
          ))}
        </div>
      )}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">ملاحظات عامة</label>
        <input name="notes" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      </div>
      <div className="flex gap-2">
        <SubmitButton>حفظ الفحص</SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-500">إغلاق</button>
      </div>
    </form>
  );
}

export function ReadinessOverrideForm({ roomId }: { roomId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(overrideReadinessAction.bind(null, roomId), null);
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-2 text-xs text-gray-500 underline">
        تجاوز الجاهزية يدوياً (بسبب إلزامي)
      </button>
    );
  }
  return (
    <form action={formAction} className="mt-3 space-y-2 border-t border-sand-100 pt-2">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      <div className="flex items-end gap-2">
        <div>
          <label className="block text-xs text-gray-500">القيمة ٪</label>
          <input name="value" type="number" min={0} max={100} required className="w-20 rounded border border-gray-300 px-2 py-1 text-sm tabular-nums" />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-gray-500">السبب (إلزامي)</label>
          <input name="reason" required className="w-full rounded border border-gray-300 px-2 py-1 text-sm" />
        </div>
      </div>
      <SubmitButton variant="secondary">تسجيل التجاوز</SubmitButton>
    </form>
  );
}

/**
 * التحكم في ملاحظة فحص مفتوحة (v2.3 §16): تحديد موعد المعالجة والمسؤولية،
 * أو إغلاقها بعد المعالجة، أو تحويلها بلاغ صيانة يتابَع من وحدة البلاغات.
 */
/**
 * v2.4 §14أ: عرض تحويل ملاحظات الفحص إلى بلاغات فور الحفظ —
 * «إنشاء بلاغات لكل الملاحظات» (مع تجاوز المكرر تلقائياً)، أو مراجعة الملاحظات
 * وتحويل المختار منها من جدولها، أو التأجيل.
 */
function ConvertFindingsOffer({
  inspectionId,
  findingsCount,
  canCreateIssues,
  onDismiss,
}: {
  inspectionId: string;
  findingsCount: number;
  canCreateIssues: boolean;
  onDismiss: () => void;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(createIssuesFromInspectionAction, null);
  const router = useRouter();
  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state?.success, router]);
  return (
    <div role="status" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
      <p className="text-sm font-medium text-amber-900">
        تم تسجيل {findingsCount} {findingsCount === 1 ? "ملاحظة تحتاج" : "ملاحظات تحتاج"} معالجة.
        {canCreateIssues && " هل تريد إنشاء بلاغات الصيانة الآن؟"}
      </p>
      {state?.error && <div role="alert" className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="mt-2 rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {canCreateIssues && !state?.success && (
          <form action={formAction}>
            <input type="hidden" name="inspectionId" value={inspectionId} />
            <SubmitButton variant="secondary">إنشاء بلاغات لكل الملاحظات</SubmitButton>
          </form>
        )}
        <a href="#findings" className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100">
          مراجعة الملاحظات وتحويل المختار منها
        </a>
        <button type="button" onClick={onDismiss} className="px-2 py-1.5 text-sm text-gray-500 hover:underline">
          لاحقاً
        </button>
      </div>
    </div>
  );
}

export function FindingControls({
  findingId,
  hasIssue,
  canCreateIssue,
}: {
  findingId: string;
  hasIssue: boolean;
  canCreateIssue: boolean;
}) {
  const [updateState, updateForm] = useActionState<ActionState, FormData>(updateFindingAction, null);
  const [closeState, closeForm] = useActionState<ActionState, FormData>(closeFindingAction, null);
  const [issueState, issueForm] = useActionState<ActionState, FormData>(createIssueFromFindingAction, null);
  const successMarker = updateState?.success || closeState?.success || issueState?.success || null;
  const router = useRouter();

  // بعد النجاح: تحديث فوري للعرض — إعادة التركيب عبر key تطوي النموذج المفتوح
  useEffect(() => {
    if (successMarker) router.refresh();
  }, [successMarker, router]);

  return (
    <FindingControlsBody
      key={successMarker ?? "init"}
      findingId={findingId}
      hasIssue={hasIssue}
      canCreateIssue={canCreateIssue}
      updateForm={updateForm}
      closeForm={closeForm}
      issueForm={issueForm}
      error={updateState?.error || closeState?.error || issueState?.error}
    />
  );
}

function FindingControlsBody({
  findingId,
  hasIssue,
  canCreateIssue,
  updateForm,
  closeForm,
  issueForm,
  error,
}: {
  findingId: string;
  hasIssue: boolean;
  canCreateIssue: boolean;
  updateForm: (formData: FormData) => void;
  closeForm: (formData: FormData) => void;
  issueForm: (formData: FormData) => void;
  error?: string;
}) {
  const [open, setOpen] = useState<"update" | "close" | null>(null);

  return (
    <div className="space-y-1.5">
      {error && <div role="alert" className="rounded bg-red-50 p-1.5 text-xs text-red-700">{error}</div>}
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => setOpen(open === "update" ? null : "update")}
          className="min-h-11 rounded border border-sand-200 px-2 py-0.5 text-xs hover:bg-sand-100 lg:min-h-0"
        >
          موعد ومسؤولية
        </button>
        <button
          type="button"
          onClick={() => setOpen(open === "close" ? null : "close")}
          className="min-h-11 rounded border border-emerald-200 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50 lg:min-h-0"
        >
          إغلاق
        </button>
        {canCreateIssue && !hasIssue && (
          <form action={issueForm} className="inline">
            <input type="hidden" name="findingId" value={findingId} />
            <SubmitButton variant="secondary">إنشاء بلاغ صيانة</SubmitButton>
          </form>
        )}
      </div>
      {open === "update" && (
        <form action={updateForm} className="space-y-2 rounded bg-sand-50 p-2">
          <input type="hidden" name="findingId" value={findingId} />
          <Field label="موعد المعالجة المستهدف" name="targetDate" type="date" />
          <Field label="المسؤول عن المعالجة" name="responsibleText" />
          <SubmitButton>حفظ</SubmitButton>
        </form>
      )}
      {open === "close" && (
        <form action={closeForm} className="space-y-2 rounded bg-sand-50 p-2">
          <input type="hidden" name="findingId" value={findingId} />
          <Field label="ماذا عولج؟ (اختياري)" name="resolutionNote" />
          <SubmitButton>إغلاق الملاحظة</SubmitButton>
        </form>
      )}
    </div>
  );
}

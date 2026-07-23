"use client";

import { useActionState, useState, useTransition } from "react";
import {
  createActivityAction,
  updateActivityProgressAction,
  completeActivityAction,
  reopenActivityAction,
  cancelActivityAction,
  archiveActivityAction,
  restoreActivityAction,
  moveActivityAction,
  duplicateActivityAction,
  addActivityDeliverableAction,
  toggleActivityDeliverableAction,
  addEvidenceRequirementAction,
  setWeightingModeAction,
  completeProgramAction,
  overrideCompleteProgramAction,
  reopenProgramCompletionAction,
  type ActionState,
} from "../activity-actions";
import { Card, Field, SubmitButton, Badge, ProgressBar } from "@/components/ui";

const EVIDENCE_ROLES = ["", "تنفيذ", "مخرج", "أثر", "خارجي"];

type Deliverable = { id: string; name: string; required: boolean; completed: boolean };
type EvidenceReq = { id: string; label: string; requiredRole: string | null; minCount: number; required: boolean; satisfiedCount: number };

export type ActivityCard = {
  id: string;
  name: string;
  description: string | null;
  ownerName: string | null;
  status: string;
  progress: number;
  weight: number | null;
  effectiveWeight: number;
  requiredForCompletion: boolean;
  plannedStart: string | null;
  plannedEnd: string | null;
  archivedAt: Date | null;
  archivedReason: string | null;
  migratedFromMilestoneId: string | null;
  evidenceCount: number;
  deliverables: Deliverable[];
  evidenceRequirements: EvidenceReq[];
};

function Notice({ notice }: { notice: { kind: "error" | "ok"; text: string } | null }) {
  if (!notice) return null;
  return (
    <div
      role={notice.kind === "error" ? "alert" : "status"}
      className={`mb-2 whitespace-pre-line rounded p-2 text-xs ${notice.kind === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}
    >
      {notice.text}
    </div>
  );
}

export function ActivityRow({
  activity,
  editable,
  people,
}: {
  activity: ActivityCard;
  editable: boolean;
  people: { id: string; fullName: string }[];
}) {
  const [notice, setNotice] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [showReason, setShowReason] = useState<"reopen" | "cancel" | "archive" | null>(null);
  const [, startTransition] = useTransition();

  const run = (fn: () => Promise<ActionState>) =>
    startTransition(async () => {
      setNotice(null);
      const res = await fn();
      if (res?.error) setNotice({ kind: "error", text: res.error });
      else if (res?.success) setNotice({ kind: "ok", text: res.success });
    });

  const reasonAction =
    showReason === "reopen" ? reopenActivityAction : showReason === "cancel" ? cancelActivityAction : archiveActivityAction;

  return (
    <div className={`rounded-lg border p-3 ${activity.archivedAt ? "border-sand-200 bg-sand-50 opacity-70" : "border-sand-200"}`}>
      <Notice notice={notice} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setOpen(!open)} className="text-sm font-medium text-brand-900 underline-offset-2 hover:underline">
              {activity.name}
            </button>
            <Badge value={activity.status} />
            {activity.archivedAt && <Badge value="مؤرشف" />}
            {activity.requiredForCompletion && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">إلزامي</span>}
            {activity.migratedFromMilestoneId && (
              <span className="rounded bg-sand-100 px-1.5 py-0.5 text-xs text-gray-500" title="منقول من معلم قديم — يُحتفظ به للمطابقة">
                منقول
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            الوزن الفعلي: {activity.effectiveWeight.toFixed(1)}٪
            {activity.ownerName && ` · المسؤول: ${activity.ownerName}`}
            {activity.plannedEnd && ` · الموعد: ${activity.plannedEnd}`}
            {activity.evidenceCount > 0 && ` · شواهد: ${activity.evidenceCount}`}
          </div>
        </div>
        <div className="w-full max-w-48">
          <ProgressBar value={activity.progress} />
        </div>
      </div>

      {editable && !activity.archivedAt && (
        <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-sand-100 pt-2">
          <form action={(fd) => run(() => updateActivityProgressAction(activity.id, null, fd))} className="flex items-end gap-2">
            <div>
              <label className="block text-xs text-gray-500" htmlFor={`pr-${activity.id}`}>نسبة الإنجاز ٪</label>
              <input
                id={`pr-${activity.id}`}
                name="progress"
                type="number"
                min={0}
                max={99}
                defaultValue={activity.progress >= 100 ? 99 : activity.progress}
                className="w-20 rounded border border-gray-300 px-2 py-1 text-xs tabular-nums"
              />
            </div>
            <button className="min-h-11 rounded bg-brand-600 px-2 py-1 text-xs text-white lg:min-h-0">حفظ</button>
          </form>

          {activity.status !== "مكتمل" ? (
            <button onClick={() => run(() => completeActivityAction(activity.id))} className="min-h-11 rounded border border-emerald-200 px-2 py-1 text-xs text-emerald-700 lg:min-h-0">
              إكمال النشاط
            </button>
          ) : (
            <button onClick={() => setShowReason("reopen")} className="min-h-11 rounded border border-sand-200 px-2 py-1 text-xs lg:min-h-0">
              إعادة فتح
            </button>
          )}
          <button onClick={() => run(() => moveActivityAction(activity.id, "up"))} className="min-h-11 rounded border border-sand-200 px-2 py-1 text-xs lg:min-h-0" aria-label="نقل لأعلى">↑</button>
          <button onClick={() => run(() => moveActivityAction(activity.id, "down"))} className="min-h-11 rounded border border-sand-200 px-2 py-1 text-xs lg:min-h-0" aria-label="نقل لأسفل">↓</button>
          <button onClick={() => run(() => duplicateActivityAction(activity.id))} className="min-h-11 rounded border border-sand-200 px-2 py-1 text-xs lg:min-h-0">نسخ</button>
          <button onClick={() => setShowReason("cancel")} className="min-h-11 rounded border border-sand-200 px-2 py-1 text-xs text-gray-600 lg:min-h-0">إلغاء</button>
          <button onClick={() => setShowReason("archive")} className="min-h-11 rounded border border-sand-200 px-2 py-1 text-xs text-gray-600 lg:min-h-0">أرشفة</button>
        </div>
      )}

      {editable && activity.archivedAt && (
        <div className="mt-2 border-t border-sand-100 pt-2">
          <p className="mb-2 text-xs text-gray-500">سبب الأرشفة: {activity.archivedReason}</p>
          <button onClick={() => run(() => restoreActivityAction(activity.id))} className="min-h-11 rounded border border-sand-200 px-3 py-1 text-xs lg:min-h-0">
            استعادة النشاط
          </button>
        </div>
      )}

      {showReason && (
        <form
          action={(fd) => {
            run(() => reasonAction(activity.id, null, fd));
            setShowReason(null);
          }}
          className="mt-2 flex flex-wrap items-end gap-2 rounded bg-sand-50 p-2"
        >
          <div className="min-w-48 flex-1">
            <label className="block text-xs text-gray-500" htmlFor={`rsn-${activity.id}`}>
              {showReason === "reopen" ? "سبب إعادة الفتح" : showReason === "cancel" ? "سبب الإلغاء" : "سبب الأرشفة"}
            </label>
            <input id={`rsn-${activity.id}`} name="reason" required className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
          </div>
          <button className="min-h-11 rounded bg-brand-600 px-3 py-1 text-xs text-white lg:min-h-0">تأكيد</button>
          <button type="button" onClick={() => setShowReason(null)} className="min-h-11 rounded border border-sand-200 px-3 py-1 text-xs lg:min-h-0">إلغاء</button>
        </form>
      )}

      {open && (
        <div className="mt-3 space-y-3 border-t border-sand-100 pt-3">
          {activity.description && <p className="text-xs text-gray-600">{activity.description}</p>}

          <div>
            <p className="mb-1 text-xs font-medium text-gray-700">المخرجات ({activity.deliverables.length})</p>
            <ul className="space-y-1">
              {activity.deliverables.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 rounded border border-sand-100 px-2 py-1 text-xs">
                  <span className="flex items-center gap-2">
                    <span className={d.completed ? "text-emerald-700 line-through" : ""}>{d.name}</span>
                    {d.required && <span className="text-amber-700">(إلزامي)</span>}
                  </span>
                  {editable && !activity.archivedAt && (
                    <button onClick={() => run(() => toggleActivityDeliverableAction(d.id))} className="text-brand-700 underline">
                      {d.completed ? "إعادة فتح" : "تم الإنجاز"}
                    </button>
                  )}
                </li>
              ))}
              {activity.deliverables.length === 0 && <li className="text-xs text-gray-400">لا مخرجات محددة</li>}
            </ul>
            {editable && !activity.archivedAt && (
              <form action={(fd) => run(() => addActivityDeliverableAction(activity.id, null, fd))} className="mt-2 flex flex-wrap items-end gap-2">
                <input name="name" placeholder="اسم المخرج" required className="min-w-40 flex-1 rounded border border-gray-300 px-2 py-1 text-xs" />
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" name="required" defaultChecked /> إلزامي
                </label>
                <button className="min-h-11 rounded border border-sand-200 px-2 py-1 text-xs lg:min-h-0">إضافة مخرج</button>
              </form>
            )}
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-gray-700">متطلبات الشواهد ({activity.evidenceRequirements.length})</p>
            <ul className="space-y-1">
              {activity.evidenceRequirements.map((r) => {
                const ok = r.satisfiedCount >= r.minCount;
                return (
                  <li key={r.id} className="flex items-center justify-between gap-2 rounded border border-sand-100 px-2 py-1 text-xs">
                    <span>
                      {r.label}
                      {r.requiredRole && ` — ${r.requiredRole}`}
                      {r.required && <span className="text-amber-700"> (إلزامي)</span>}
                    </span>
                    <span className={ok ? "text-emerald-700" : "text-red-600"}>
                      {r.satisfiedCount} / {r.minCount}
                    </span>
                  </li>
                );
              })}
              {activity.evidenceRequirements.length === 0 && <li className="text-xs text-gray-400">لا متطلبات شواهد</li>}
            </ul>
            {editable && !activity.archivedAt && (
              <form action={(fd) => run(() => addEvidenceRequirementAction(activity.id, null, fd))} className="mt-2 flex flex-wrap items-end gap-2">
                <input name="label" placeholder="وصف المتطلب" required className="min-w-36 flex-1 rounded border border-gray-300 px-2 py-1 text-xs" />
                <select name="requiredRole" className="rounded border border-gray-300 px-2 py-1 text-xs">
                  {EVIDENCE_ROLES.map((r) => (
                    <option key={r} value={r}>{r || "أي تصنيف"}</option>
                  ))}
                </select>
                <input name="minCount" type="number" min={1} defaultValue={1} className="w-16 rounded border border-gray-300 px-2 py-1 text-xs" aria-label="الحد الأدنى" />
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" name="required" defaultChecked /> إلزامي
                </label>
                <button className="min-h-11 rounded border border-sand-200 px-2 py-1 text-xs lg:min-h-0">إضافة متطلب</button>
              </form>
            )}
          </div>

          <p className="text-xs text-gray-400">
            الشواهد تُربط من قسم «الشواهد المرتبطة» أدناه — الشاهد الواحد يخدم النشاط والبرنامج ومصروف الميزانية بلا رفع مكرر.
          </p>
        </div>
      )}
    </div>
  );
}

export function AddActivityForm({ programId, people }: { programId: string; people: { id: string; fullName: string }[] }) {
  const [state, formAction] = useActionState<ActionState, FormData>(createActivityAction.bind(null, programId), null);
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3">
      <button onClick={() => setOpen(!open)} className="min-h-11 rounded-lg border border-sand-200 px-3 py-1.5 text-sm hover:bg-sand-100 lg:min-h-0">
        {open ? "إغلاق" : "إضافة نشاط"}
      </button>
      {open && (
        <form key={state?.success} action={formAction} className="mt-3 space-y-3 rounded-lg bg-sand-50 p-3">
          {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
          {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
          <Field label="اسم النشاط" name="name" required />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="ownerPersonId">المسؤول (من سجل المنسوبين)</label>
              <select id="ownerPersonId" name="ownerPersonId" className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0">
                <option value="">— بلا مسؤول —</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.fullName}</option>
                ))}
              </select>
            </div>
            <Field label="الوزن المخصص ٪ (اختياري)" name="weight" type="number" />
            <Field label="البداية المخططة" name="plannedStart" />
            <Field label="النهاية المخططة" name="plannedEnd" />
          </div>
          <Field label="وصف مختصر (اختياري)" name="description" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="requiredForCompletion" defaultChecked /> نشاط إلزامي لاكتمال البرنامج
          </label>
          <SubmitButton>حفظ النشاط</SubmitButton>
        </form>
      )}
    </div>
  );
}

export function WeightingModeForm({ programId, mode, problems }: { programId: string; mode: string; problems: string[] }) {
  const [state, formAction] = useActionState<ActionState, FormData>(setWeightingModeAction.bind(null, programId), null);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      {state?.error && <div role="alert" className="w-full rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="w-full rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      <div>
        <label className="block text-xs text-gray-500" htmlFor="weightingMode">وضع الوزن</label>
        <select id="weightingMode" name="weightingMode" defaultValue={mode} className="min-h-11 rounded border border-gray-300 px-2 py-1 text-xs lg:min-h-0">
          <option value="متساوٍ">متساوٍ — كل نشاط بوزن واحد</option>
          <option value="مخصص">مخصص — المجموع 100٪</option>
        </select>
      </div>
      <button className="min-h-11 rounded border border-sand-200 px-3 py-1 text-xs lg:min-h-0">تطبيق</button>
      {problems.length > 0 && (
        <p className="w-full text-xs text-red-600">أوزان غير صالحة: {problems.join("، ")}</p>
      )}
    </form>
  );
}

export function ReadinessPanel({
  programId,
  readiness,
  completed,
  override,
  overrideReason,
  overrideReadiness,
  overrideMissing,
  canApprove,
  canOverride,
}: {
  programId: string;
  readiness: { percent: number; statusAr: string; ready: boolean; missing: { labelAr: string; href?: string }[] };
  completed: boolean;
  override: boolean;
  overrideReason: string | null;
  overrideReadiness: number | null;
  overrideMissing: string[] | null;
  canApprove: boolean;
  canOverride: boolean;
}) {
  const [notice, setNotice] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [showOverride, setShowOverride] = useState(false);
  const [showReopen, setShowReopen] = useState(false);
  const [, startTransition] = useTransition();

  const run = (fn: () => Promise<ActionState>) =>
    startTransition(async () => {
      setNotice(null);
      const res = await fn();
      if (res?.error) setNotice({ kind: "error", text: res.error });
      else if (res?.success) setNotice({ kind: "ok", text: res.success });
    });

  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold text-brand-900">جاهزية الإقفال</h2>
        <span className={`text-sm tabular-nums ${readiness.ready ? "text-emerald-600" : "text-amber-600"}`}>{readiness.percent}٪</span>
      </div>
      <Notice notice={notice} />
      <p className={`text-sm ${readiness.ready ? "text-emerald-700" : "text-amber-800"}`}>{readiness.statusAr}</p>

      {completed && (
        <div className={`mt-3 rounded-lg p-3 text-sm ${override ? "border border-amber-300 bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-800"}`}>
          {override ? (
            <>
              <p className="font-medium">مكتمل بتجاوز موثّق — الجاهزية وقت الإقفال {overrideReadiness}٪</p>
              <p className="mt-1 text-xs">المبرر: {overrideReason}</p>
              {overrideMissing && overrideMissing.length > 0 && (
                <>
                  <p className="mt-2 text-xs font-medium">النواقص المسجّلة وقت الإقفال ({overrideMissing.length}):</p>
                  <ul className="mt-1 list-inside list-disc text-xs">
                    {overrideMissing.map((m, i) => <li key={i}>{m}</li>)}
                  </ul>
                </>
              )}
            </>
          ) : (
            <p className="font-medium">مكتمل بجاهزية كاملة</p>
          )}
        </div>
      )}

      {!completed && readiness.missing.length > 0 && (
        <ul className="mt-3 space-y-1">
          {readiness.missing.map((m, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-100 bg-amber-50/50 px-2 py-1 text-xs text-amber-900">
              <span>{m.labelAr}</span>
              {m.href && <a href={m.href} className="text-brand-700 underline">فتح</a>}
            </li>
          ))}
        </ul>
      )}

      {canApprove && !completed && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => run(() => completeProgramAction(programId))}
            disabled={!readiness.ready}
            title={readiness.ready ? undefined : "الإقفال الطبيعي متاح عند جاهزية 100٪ فقط"}
            className="min-h-11 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
          >
            إقفال البرنامج
          </button>
          {!readiness.ready && canOverride && (
            <button onClick={() => setShowOverride(!showOverride)} className="min-h-11 rounded-lg border border-amber-300 px-4 py-2 text-sm text-amber-800 lg:min-h-0">
              إقفال بتجاوز (المدير)
            </button>
          )}
        </div>
      )}

      {showOverride && (
        <form action={(fd) => { run(() => overrideCompleteProgramAction(programId, null, fd)); setShowOverride(false); }} className="mt-3 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs text-amber-900">
            الإقفال بتجاوز يسجّل المستخدم والتاريخ والمبرر ونسبة الجاهزية وقائمة النواقص، وتبقى النواقص ظاهرة في التقارير التاريخية.
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-amber-900" htmlFor="ovr">المبرر (10 أحرف على الأقل)</label>
            <textarea id="ovr" name="reason" rows={2} required minLength={10} className="w-full rounded border border-amber-300 px-2 py-1 text-sm" />
          </div>
          <SubmitButton variant="danger" confirmText="إقفال البرنامج رغم النواقص؟ سيُسجَّل التجاوز بالكامل.">تأكيد الإقفال بتجاوز</SubmitButton>
        </form>
      )}

      {canApprove && completed && (
        <div className="mt-3">
          <button onClick={() => setShowReopen(!showReopen)} className="min-h-11 rounded-lg border border-sand-200 px-4 py-2 text-sm lg:min-h-0">
            إعادة فتح البرنامج
          </button>
          {showReopen && (
            <form action={(fd) => { run(() => reopenProgramCompletionAction(programId, null, fd)); setShowReopen(false); }} className="mt-2 flex flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1">
                <label className="block text-xs text-gray-500" htmlFor="rop">سبب إعادة الفتح</label>
                <input id="rop" name="reason" required className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
              </div>
              <button className="min-h-11 rounded bg-brand-600 px-3 py-1 text-xs text-white lg:min-h-0">تأكيد</button>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}

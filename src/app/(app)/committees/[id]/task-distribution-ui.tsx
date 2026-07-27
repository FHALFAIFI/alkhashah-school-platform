"use client";

import { useActionState, useState, useTransition } from "react";
import {
  loadCommitteeTasksAction,
  addCommitteeTaskAction,
  updateCommitteeTaskAction,
  assignCommitteeTaskAction,
  toggleCommitteeTaskExcludedAction,
  moveCommitteeTaskAction,
  deleteCommitteeTaskAction,
  type ActionState,
} from "../task-actions";
import { SubmitButton } from "@/components/ui";
import { orFallback } from "@/lib/format";

type TaskRow = {
  id: string;
  title: string;
  notes: string | null;
  excluded: boolean;
  assignedMemberId: string | null;
  memberName: string | null;
  memberRole: string | null;
};
type Member = { id: string; name: string; role: string };

/**
 * توزيع مهام اللجنة (D-027): تحميل المهام المعرّفة مسبقاً ثم مراجعتها (إضافة/تعديل/استبعاد/ترتيب)
 * وإسنادها للأعضاء. جدول التوزيع المطبوع يتضمن عمود «توقيع العضو».
 */
export function TaskDistribution({
  committeeId,
  tasks,
  members,
  hasTemplate,
  canWrite,
}: {
  committeeId: string;
  tasks: TaskRow[];
  members: Member[];
  hasTemplate: boolean;
  canWrite: boolean;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run(fn: () => Promise<ActionState>) {
    start(async () => {
      const res = await fn();
      setMsg(res?.error ?? res?.success ?? null);
    });
  }

  return (
    <div className="space-y-3">
      {msg && <div role="status" className="rounded bg-sand-50 p-2 text-xs text-gray-700">{msg}</div>}

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          {hasTemplate && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => loadCommitteeTasksAction(committeeId))}
              className="min-h-11 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm text-brand-900 hover:bg-brand-100 disabled:opacity-50 lg:min-h-0"
            >
              تحميل المهام المعرّفة مسبقاً
            </button>
          )}
          <span className="text-xs text-gray-400">أو أضف مهمة يدوياً أدناه — ثم أسندها لعضو</span>
        </div>
      )}

      {tasks.length === 0 ? (
        <p className="text-sm text-gray-400">لا مهام بعد — حمّل المهام المعرّفة مسبقاً لنوع اللجنة أو أضف مهمة يدوياً.</p>
      ) : (
        <ol className="space-y-2">
          {tasks.map((t, i) => (
            <TaskItem
              key={t.id}
              index={i + 1}
              task={t}
              members={members}
              canWrite={canWrite}
              first={i === 0}
              last={i === tasks.length - 1}
              onRun={run}
              pending={pending}
            />
          ))}
        </ol>
      )}

      {canWrite && <AddTaskForm committeeId={committeeId} />}

      {canWrite && (
        <p className="text-xs text-gray-400">
          بعد مراجعة المهام، ولّد «نموذج التكليف» من بطاقة النموذج أدناه — قائمتان مستقلتان: «أعضاء اللجنة»
          (بعمود «التوقيع» الورقي) و«مهام اللجنة».
        </p>
      )}
    </div>
  );
}

function TaskItem({
  index,
  task,
  members,
  canWrite,
  first,
  last,
  onRun,
  pending,
}: {
  index: number;
  task: TaskRow;
  members: Member[];
  canWrite: boolean;
  first: boolean;
  last: boolean;
  onRun: (fn: () => Promise<ActionState>) => void;
  pending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <li className={`rounded-lg border p-3 ${task.excluded ? "border-dashed border-sand-300 bg-sand-50/60 opacity-70" : "border-sand-200"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 basis-64">
          <span className="text-sm font-medium text-gray-800">
            {index}. {orFallback(task.title)} {task.excluded && <span className="text-xs text-gray-400">(مستبعدة)</span>}
          </span>
          {task.notes && <p className="mt-0.5 text-xs text-gray-500">ملاحظات: {task.notes}</p>}
          <p className="mt-0.5 text-xs text-gray-500">
            العضو المكلف: {task.memberName ?? "—"}{task.memberRole ? ` (${task.memberRole})` : ""}
          </p>
        </div>
        {canWrite && (
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              defaultValue={task.assignedMemberId ?? ""}
              onChange={(e) => onRun(() => assignCommitteeTaskAction(task.id, e.target.value))}
              disabled={pending}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs"
              aria-label="إسناد المهمة لعضو"
            >
              <option value="">— بلا إسناد —</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
              ))}
            </select>
            <button type="button" disabled={pending || first} onClick={() => onRun(() => moveCommitteeTaskAction(task.id, "up"))} className="rounded border border-sand-200 px-2 py-1 text-xs disabled:opacity-40" aria-label="أعلى">▲</button>
            <button type="button" disabled={pending || last} onClick={() => onRun(() => moveCommitteeTaskAction(task.id, "down"))} className="rounded border border-sand-200 px-2 py-1 text-xs disabled:opacity-40" aria-label="أسفل">▼</button>
            <button type="button" disabled={pending} onClick={() => onRun(() => toggleCommitteeTaskExcludedAction(task.id, !task.excluded))} className="rounded border border-sand-200 px-2 py-1 text-xs">
              {task.excluded ? "تضمين" : "استبعاد"}
            </button>
            <button type="button" onClick={() => setEditing((v) => !v)} className="rounded border border-sand-200 px-2 py-1 text-xs">تعديل</button>
            <button type="button" disabled={pending} onClick={() => { if (window.confirm("حذف هذه المهمة؟")) onRun(() => deleteCommitteeTaskAction(task.id)); }} className="rounded px-2 py-1 text-xs text-red-500 hover:underline">حذف</button>
          </div>
        )}
      </div>
      {editing && canWrite && <EditTaskForm taskId={task.id} title={task.title} notes={task.notes} onDone={() => setEditing(false)} />}
    </li>
  );
}

function AddTaskForm({ committeeId }: { committeeId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(addCommitteeTaskAction.bind(null, committeeId), null);
  return (
    <form key={state?.success} action={formAction} className="flex flex-wrap items-end gap-2 rounded-lg bg-sand-50 p-3">
      {state?.error && <div role="alert" className="w-full rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      <div className="min-w-0 flex-1 basis-56">
        <label className="mb-1 block text-xs text-gray-500">مهمة جديدة</label>
        <input name="title" placeholder="نص المهمة" className="w-full min-w-0 rounded border border-gray-300 px-2 py-1.5 text-sm" />
      </div>
      <div className="min-w-0 flex-1 basis-40">
        <label className="mb-1 block text-xs text-gray-500">ملاحظات (اختياري)</label>
        <input name="notes" className="w-full min-w-0 rounded border border-gray-300 px-2 py-1.5 text-sm" />
      </div>
      <SubmitButton variant="secondary">إضافة مهمة</SubmitButton>
    </form>
  );
}

function EditTaskForm({ taskId, title, notes, onDone }: { taskId: string; title: string; notes: string | null; onDone: () => void }) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateCommitteeTaskAction.bind(null, taskId), null);
  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2 border-t border-sand-100 pt-2">
      {state?.error && <div role="alert" className="w-full rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <span className="w-full text-xs text-emerald-700">{state.success}</span>}
      <div className="min-w-0 flex-1 basis-56">
        <label className="mb-1 block text-xs text-gray-500">المهمة</label>
        <input name="title" defaultValue={title} className="w-full min-w-0 rounded border border-gray-300 px-2 py-1.5 text-sm" />
      </div>
      <div className="min-w-0 flex-1 basis-40">
        <label className="mb-1 block text-xs text-gray-500">ملاحظات</label>
        <input name="notes" defaultValue={notes ?? ""} className="w-full min-w-0 rounded border border-gray-300 px-2 py-1.5 text-sm" />
      </div>
      <SubmitButton variant="secondary">حفظ</SubmitButton>
      <button type="button" onClick={onDone} className="rounded border border-sand-200 px-3 py-1.5 text-sm text-gray-600">إغلاق</button>
    </form>
  );
}

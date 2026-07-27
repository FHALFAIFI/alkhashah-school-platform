"use client";

import { useActionState, useState, useTransition } from "react";
import {
  seedTaskTemplatesAction,
  addTaskTemplateAction,
  updateTaskTemplateAction,
  toggleTaskTemplateAction,
  moveTaskTemplateAction,
  deleteTaskTemplateAction,
  type ActionState,
} from "../task-actions";
import { SubmitButton } from "@/components/ui";

type Tmpl = { id: string; title: string; active: boolean };

export function SeedButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => { const r = await seedTaskTemplatesAction(); setMsg(r?.error ?? r?.success ?? null); })}
        className="min-h-11 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm text-brand-900 hover:bg-brand-100 disabled:opacity-50 lg:min-h-0"
      >
        بذر المهام الافتراضية من مهام القوالب
      </button>
      <span className="text-xs text-gray-400">لا يكرّر ولا يعيد كتابة أي تعديل — يضيف فقط لأنواع بلا قوالب مهام.</span>
      {msg && <span role="status" className="text-xs text-emerald-700">{msg}</span>}
    </div>
  );
}

export function TaskTemplateManager({ templateKey, tasks, canManage }: { templateKey: string; tasks: Tmpl[]; canManage: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  function run(fn: () => Promise<ActionState>) {
    start(async () => { const r = await fn(); setMsg(r?.error ?? r?.success ?? null); });
  }

  return (
    <div className="space-y-2">
      {msg && <div role="status" className="rounded bg-sand-50 p-2 text-xs text-gray-700">{msg}</div>}
      {tasks.length === 0 ? (
        <p className="text-sm text-gray-400">لا مهام معرّفة لهذا النوع — أضفها أدناه أو ابذر الافتراضية.</p>
      ) : (
        <ol className="space-y-1.5">
          {tasks.map((t, i) => (
            <li key={t.id} className={`rounded-lg border px-3 py-2 text-sm ${t.active ? "border-sand-200" : "border-dashed border-sand-300 bg-sand-50/60 opacity-70"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{i + 1}. {t.title} {!t.active && <span className="text-xs text-gray-400">(معطّلة)</span>}</span>
                {canManage && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button type="button" disabled={pending || i === 0} onClick={() => run(() => moveTaskTemplateAction(t.id, "up"))} className="rounded border border-sand-200 px-2 py-0.5 text-xs disabled:opacity-40">▲</button>
                    <button type="button" disabled={pending || i === tasks.length - 1} onClick={() => run(() => moveTaskTemplateAction(t.id, "down"))} className="rounded border border-sand-200 px-2 py-0.5 text-xs disabled:opacity-40">▼</button>
                    <button type="button" disabled={pending} onClick={() => run(() => toggleTaskTemplateAction(t.id, !t.active))} className="rounded border border-sand-200 px-2 py-0.5 text-xs">{t.active ? "تعطيل" : "تفعيل"}</button>
                    <button type="button" onClick={() => setEditingId(editingId === t.id ? null : t.id)} className="rounded border border-sand-200 px-2 py-0.5 text-xs">تعديل</button>
                    <button type="button" disabled={pending} onClick={() => { if (window.confirm("حذف قالب المهمة؟ لا يؤثر على التوزيعات الصادرة.")) run(() => deleteTaskTemplateAction(t.id)); }} className="rounded px-2 py-0.5 text-xs text-red-500 hover:underline">حذف</button>
                  </div>
                )}
              </div>
              {editingId === t.id && canManage && <EditTemplateForm id={t.id} title={t.title} onDone={() => setEditingId(null)} />}
            </li>
          ))}
        </ol>
      )}
      {canManage && <AddTemplateForm templateKey={templateKey} />}
    </div>
  );
}

function AddTemplateForm({ templateKey }: { templateKey: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(addTaskTemplateAction, null);
  return (
    <form key={state?.success} action={formAction} className="flex flex-wrap items-end gap-2 rounded-lg bg-sand-50 p-2">
      {state?.error && <div role="alert" className="w-full rounded bg-red-50 p-1.5 text-xs text-red-700">{state.error}</div>}
      <input type="hidden" name="templateKey" value={templateKey} />
      <div className="min-w-0 flex-1 basis-56">
        <input name="title" placeholder="مهمة معرّفة جديدة" className="w-full min-w-0 rounded border border-gray-300 px-2 py-1.5 text-sm" />
      </div>
      <SubmitButton variant="secondary">إضافة قالب مهمة</SubmitButton>
    </form>
  );
}

function EditTemplateForm({ id, title, onDone }: { id: string; title: string; onDone: () => void }) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateTaskTemplateAction.bind(null, id), null);
  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2 border-t border-sand-100 pt-2">
      {state?.error && <div role="alert" className="w-full rounded bg-red-50 p-1.5 text-xs text-red-700">{state.error}</div>}
      {state?.success && <span className="w-full text-xs text-emerald-700">{state.success}</span>}
      <div className="min-w-0 flex-1 basis-56">
        <input name="title" defaultValue={title} className="w-full min-w-0 rounded border border-gray-300 px-2 py-1.5 text-sm" />
      </div>
      <SubmitButton variant="secondary">حفظ</SubmitButton>
      <button type="button" onClick={onDone} className="rounded border border-sand-200 px-3 py-1.5 text-sm text-gray-600">إغلاق</button>
    </form>
  );
}

"use client";

import { useActionState, useState, useTransition } from "react";
import { createEvidenceAction, deleteEvidenceAction, type ActionState } from "@/app/(app)/evidence/actions";
import { Card, Field, SubmitButton, Badge } from "@/components/ui";

const ROLES = ["خط أساس", "تنفيذ", "مخرج", "أثر", "خارجي"];

export function EvidencePanel({
  entityType,
  entityId,
  items,
  canWrite,
}: {
  entityType: string;
  entityId: string;
  items: { id: string; title: string; kind: string; role: string | null; fileId: string | null }[];
  canWrite: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(createEvidenceAction, null);
  const [kind, setKind] = useState("file");
  const [showForm, setShowForm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-bold text-brand-900">الشواهد المرتبطة ({items.length})</h2>
        {canWrite && (
          <button onClick={() => setShowForm(!showForm)} className="rounded-lg border border-sand-200 px-3 py-1.5 text-sm hover:bg-sand-100">
            {showForm ? "إغلاق" : "إضافة شاهد"}
          </button>
        )}
      </div>

      {deleteError && <div role="alert" className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{deleteError}</div>}

      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-sand-100 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium">{item.title}</span>
              {item.role && <Badge value={item.role} />}
              <span className="text-xs text-gray-400">{item.kind === "file" ? "ملف" : item.kind === "link" ? "رابط" : "نص"}</span>
            </div>
            <div className="flex items-center gap-2">
              {item.fileId && (
                <a href={`/api/files/${item.fileId}`} className="text-xs text-brand-700 underline">تنزيل</a>
              )}
              {canWrite && (
                <button
                  onClick={() =>
                    startTransition(async () => {
                      setDeleteError(null);
                      const res = await deleteEvidenceAction(item.id);
                      if (res?.error) setDeleteError(res.error);
                    })
                  }
                  className="text-xs text-red-500 hover:underline"
                >
                  حذف
                </button>
              )}
            </div>
          </li>
        ))}
        {items.length === 0 && <li className="text-sm text-gray-400">لا شواهد بعد</li>}
      </ul>

      {showForm && canWrite && (
        <form action={formAction} className="mt-4 space-y-3 rounded-lg bg-sand-50 p-3">
          {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
          {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
          <input type="hidden" name="entityType" value={entityType} />
          <input type="hidden" name="entityId" value={entityId} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="عنوان الشاهد" name="title" required />
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">دور الشاهد</label>
              <select name="role" className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">— بدون —</option>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">نوع الشاهد</label>
            <div className="flex gap-3 text-sm">
              {[["file", "ملف"], ["link", "رابط"], ["text", "نص"]].map(([v, l]) => (
                <label key={v} className="flex items-center gap-1">
                  <input type="radio" name="kind" value={v} checked={kind === v} onChange={() => setKind(v)} />
                  {l}
                </label>
              ))}
            </div>
          </div>
          {kind === "file" && (
            <input name="file" type="file" className="w-full rounded-lg border border-dashed border-gray-300 p-3 text-sm" />
          )}
          {kind === "link" && <Field label="الرابط" name="url" dir="ltr" placeholder="https://..." />}
          {kind === "text" && (
            <textarea name="textContent" rows={3} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="نص الشاهد" />
          )}
          <Field label="وصف مختصر" name="description" />
          <SubmitButton>حفظ الشاهد</SubmitButton>
        </form>
      )}
    </Card>
  );
}

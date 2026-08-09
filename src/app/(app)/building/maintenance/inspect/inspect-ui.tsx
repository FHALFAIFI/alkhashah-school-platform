"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  submitInspectionAction,
  createIssuesFromInspectionAction,
  createSelectedIssuesFromInspectionAction,
  type ActionState,
  type InspectionSubmitState,
  type ActionableFinding,
} from "../../actions";
import { SubmitButton } from "@/components/ui";
import { useRefreshOnSuccess } from "@/components/form-reset";
import {
  CREATE_ALL_SEPARATE_CTA,
  CREATE_SELECTED_CTA,
  REVIEW_BEFORE_CREATE_CTA,
  SKIP_FOR_NOW_CTA,
  VIEW_ISSUE_CTA,
} from "@/lib/building/maintenance-report";

/**
 * v2.4.1 §1.2: سير «إجراء فحص» داخل منطقة الصيانة.
 *
 * ثلاث مراحل في شاشة واحدة بلا انتقال: اختيار الموقع والقالب ← تسجيل النتائج ←
 * نتيجة صريحة بعدد الملاحظات مع أربعة مسارات (إنشاء المحدد / إنشاء بلاغ منفصل لكل
 * ملاحظة / مراجعة قبل الإنشاء / تخطي الآن).
 *
 * البلاغ **منفصل لكل ملاحظة** — لا تجميع. والملاحظة التي لها بلاغ مفتوح لنفس البند
 * تُعرض معطّلة مع رابط البلاغ القائم، فلا يُنشأ مكرر بالخطأ.
 */

type RoomOption = { id: string; label: string; templateIds: string[] };
type TemplateOption = { id: string; nameAr: string; items: { key: string; label: string; required: boolean }[] };

export function MaintenanceInspectionFlow({
  rooms,
  templates,
  canCreateIssues,
}: {
  rooms: RoomOption[];
  templates: TemplateOption[];
  canCreateIssues: boolean;
}) {
  const [state, formAction] = useActionState<InspectionSubmitState, FormData>(submitInspectionAction, null);
  // D-049: الإجراء لم يعد يُبطل أي مسار — تحديث القوائم مسؤولية العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(rooms[0]?.templateIds[0] ?? "");
  const [dismissed, setDismissed] = useState(false);

  const room = rooms.find((r) => r.id === roomId);
  const available = templates.filter((t) => room?.templateIds.includes(t.id));
  const template = available.find((t) => t.id === templateId) ?? available[0];

  const onRoomChange = (id: string) => {
    setRoomId(id);
    const next = rooms.find((r) => r.id === id);
    setTemplateId(next?.templateIds[0] ?? "");
  };

  const findings = state?.findings ?? [];
  const showResult = Boolean(state?.inspectionId) && !dismissed;

  return (
    <div className="space-y-4">
      {showResult && state?.inspectionId && (
        <InspectionResultPanel
          inspectionId={state.inspectionId}
          message={state.success ?? ""}
          findings={findings}
          canCreateIssues={canCreateIssues}
          onSkip={() => setDismissed(true)}
        />
      )}

      <form action={formAction} className="space-y-3">
        {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="insp-room" className="mb-1 block text-sm font-medium text-gray-700">الموقع</label>
            <select
              id="insp-room"
              name="roomId"
              value={roomId}
              onChange={(e) => onRoomChange(e.target.value)}
              className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0"
            >
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="insp-tpl" className="mb-1 block text-sm font-medium text-gray-700">قالب الفحص</label>
            <select
              id="insp-tpl"
              name="templateId"
              value={template?.id ?? ""}
              onChange={(e) => setTemplateId(e.target.value)}
              className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0"
            >
              {available.map((t) => (
                <option key={t.id} value={t.id}>{t.nameAr}</option>
              ))}
            </select>
          </div>
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
                <input
                  name={`note_${item.key}`}
                  placeholder="ملاحظة"
                  className="w-40 rounded border border-gray-300 px-2 py-1 text-xs"
                />
              </div>
            ))}
          </div>
        )}

        <div>
          <label htmlFor="insp-notes" className="mb-1 block text-sm font-medium text-gray-700">ملاحظات عامة</label>
          <input id="insp-notes" name="notes" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>

        <SubmitButton>حفظ الفحص</SubmitButton>
      </form>
    </div>
  );
}

/** نتيجة الفحص وأربعة مسارات صريحة بعدها */
function InspectionResultPanel({
  inspectionId,
  message,
  findings,
  canCreateIssues,
  onSkip,
}: {
  inspectionId: string;
  message: string;
  findings: ActionableFinding[];
  canCreateIssues: boolean;
  onSkip: () => void;
}) {
  const [selectedState, selectedAction] = useActionState<ActionState, FormData>(createSelectedIssuesFromInspectionAction, null);
  const [allState, allAction] = useActionState<ActionState, FormData>(createIssuesFromInspectionAction, null);
  useRefreshOnSuccess(selectedState);
  useRefreshOnSuccess(allState);
  const [review, setReview] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const creatable = findings.filter((f) => !f.duplicateIssue);
  const done = selectedState?.success || allState?.success;

  if (findings.length === 0) {
    return (
      <div role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
        {message}
      </div>
    );
  }

  return (
    <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3">
      <p className="text-sm font-medium text-amber-900">{message}</p>

      {selectedState?.error && <div role="alert" className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{selectedState.error}</div>}
      {allState?.error && <div role="alert" className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{allState.error}</div>}
      {done && <div role="status" className="mt-2 rounded bg-emerald-50 p-2 text-xs text-emerald-700">{done}</div>}

      {!done && (
        <>
          {review && (
            <div className="mt-3 space-y-2 rounded-lg border border-amber-200 bg-white p-3">
              <p className="text-xs text-gray-600">
                كل ملاحظة مختارة تُنشئ <strong>بلاغ صيانة منفصلاً</strong> مرتبطاً بها وبفحصها وبموقعها.
              </p>
              {findings.map((f) => (
                <label
                  key={f.id}
                  className={`flex items-start gap-2 rounded border px-2 py-1.5 text-xs ${
                    f.duplicateIssue ? "border-gray-200 bg-gray-50 text-gray-500" : "border-sand-200"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    disabled={Boolean(f.duplicateIssue)}
                    checked={selected.includes(f.id)}
                    onChange={(e) =>
                      setSelected((prev) => (e.target.checked ? [...prev, f.id] : prev.filter((x) => x !== f.id)))
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{f.label}</span>
                    <span className="text-gray-500"> — خطورة: {f.severity}{f.critical ? " (حرج)" : ""}</span>
                    {f.note && <span className="block text-gray-500">{f.note}</span>}
                    {f.duplicateIssue && (
                      <span className="mt-0.5 block text-amber-800">
                        يوجد بلاغ مفتوح لنفس البند ({f.duplicateIssue.code} — {f.duplicateIssue.status}) —{" "}
                        <Link prefetch={false} href={`/building/maintenance/${f.duplicateIssue.id}`} className="underline">
                          {VIEW_ISSUE_CTA}
                        </Link>
                        {" "}بدل إنشاء بلاغ مكرر.
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {canCreateIssues && review && (
              <form action={selectedAction}>
                <input type="hidden" name="inspectionId" value={inspectionId} />
                {selected.map((id) => (
                  <input key={id} type="hidden" name="findingId" value={id} />
                ))}
                <SubmitButton variant="secondary">
                  {CREATE_SELECTED_CTA}{selected.length > 0 ? ` (${selected.length})` : ""}
                </SubmitButton>
              </form>
            )}
            {canCreateIssues && (
              <form action={allAction}>
                <input type="hidden" name="inspectionId" value={inspectionId} />
                <SubmitButton variant="secondary">
                  {CREATE_ALL_SEPARATE_CTA}{creatable.length > 0 ? ` (${creatable.length})` : ""}
                </SubmitButton>
              </form>
            )}
            {!review && (
              <button
                type="button"
                onClick={() => setReview(true)}
                className="min-h-11 rounded-lg border border-amber-300 px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100 lg:min-h-0"
              >
                {REVIEW_BEFORE_CREATE_CTA}
              </button>
            )}
            <button type="button" onClick={onSkip} className="px-2 py-1.5 text-sm text-gray-500 hover:underline">
              {SKIP_FOR_NOW_CTA}
            </button>
          </div>
        </>
      )}

      {done && (
        <p className="mt-2 text-xs text-amber-900">
          افتح البلاغات من <Link prefetch={false} href="/building/maintenance" className="underline">بلاغات الصيانة</Link> لاعتمادها وإصدار تقاريرها.
        </p>
      )}
    </div>
  );
}

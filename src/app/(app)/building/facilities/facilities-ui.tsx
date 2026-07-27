"use client";

import { useActionState, useState, useTransition } from "react";
import {
  addFacilityAction,
  seedStandardFacilitiesAction,
  setFacilityStatusAction,
  linkFacilityRoomAction,
  unlinkFacilityRoomAction,
  deleteFacilityAction,
  type ActionState,
} from "./actions";
import { FACILITY_STATUSES } from "./constants";
import { Field, SubmitButton, Badge } from "@/components/ui";
import { orFallback } from "@/lib/format";

type Room = { id: string; label: string };
export type FacilityView = {
  id: string;
  facilityType: string;
  kind: string;
  status: string;
  requiredQty: number | null;
  notes: string | null;
  linkedRooms: { id: string; label: string }[];
};

export function AddFacilityForm({ hasStandard }: { hasStandard: boolean }) {
  const [state, formAction] = useActionState<ActionState, FormData>(addFacilityAction, null);
  const [seedNotice, setSeedNotice] = useState<string | null>(null);
  const [seedPending, startSeed] = useTransition();
  return (
    <div className="flex flex-wrap items-start gap-3">
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        {state?.error && <div role="alert" className="w-full rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
        {state?.success && <div role="status" className="w-full rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
        <input type="hidden" name="kind" value="مخصص" />
        <Field label="مرفق مخصص" name="facilityType" />
        <Field label="العدد المطلوب (اختياري)" name="requiredQty" type="number" />
        <SubmitButton variant="secondary">إضافة مرفق</SubmitButton>
      </form>
      {!hasStandard && (
        <div>
          {seedNotice && <div role="status" className="mb-1 rounded bg-emerald-50 p-2 text-xs text-emerald-700">{seedNotice}</div>}
          <button
            disabled={seedPending}
            onClick={() =>
              startSeed(async () => {
                const res = await seedStandardFacilitiesAction();
                if (res?.success) setSeedNotice(res.success);
              })
            }
            className="min-h-11 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 lg:min-h-0"
          >
            إضافة القائمة المعيارية
          </button>
        </div>
      )}
    </div>
  );
}

export function FacilityRow({ facility, rooms, canWrite }: { facility: FacilityView; rooms: Room[]; canWrite: boolean }) {
  const [notice, setNotice] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [, startTransition] = useTransition();
  const [linkState, linkAction] = useActionState<ActionState, FormData>(linkFacilityRoomAction.bind(null, facility.id), null);

  const run = (fn: () => Promise<ActionState>) =>
    startTransition(async () => {
      setNotice(null);
      const res = await fn();
      if (res?.error) setNotice({ kind: "error", text: res.error });
      else if (res?.success) setNotice({ kind: "ok", text: res.success });
    });

  const statusTone = facility.status === "موجود" ? "good" : facility.status === "غير مطلوب" ? "muted" : "warn";
  const availableQty = facility.linkedRooms.length;

  return (
    <div className="rounded-lg border border-sand-200 p-3">
      {notice && (
        <div role={notice.kind === "error" ? "alert" : "status"} className={`mb-2 rounded p-2 text-xs ${notice.kind === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
          {notice.text}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-brand-900">{orFallback(facility.facilityType)}</span>
          {facility.kind === "مخصص" && <span className="rounded bg-sand-100 px-1.5 py-0.5 text-xs text-gray-500">مخصص</span>}
          <Badge value={facility.status} />
          <span className={`text-xs ${statusTone === "warn" ? "text-amber-600" : "text-gray-500"}`}>
            المتوفر: {availableQty}{facility.requiredQty != null ? ` / المطلوب: ${facility.requiredQty}` : ""}
          </span>
        </div>
        {canWrite && (
          <div className="flex flex-wrap items-center gap-1">
            {FACILITY_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => run(() => setFacilityStatusAction(facility.id, s))}
                className={`min-h-11 rounded border px-2 py-1 text-xs lg:min-h-0 ${facility.status === s ? "border-brand-400 bg-brand-50 text-brand-800" : "border-sand-200"}`}
              >
                {s}
              </button>
            ))}
            <button onClick={() => run(() => deleteFacilityAction(facility.id))} className="min-h-11 rounded border border-sand-200 px-2 py-1 text-xs text-red-500 lg:min-h-0">حذف</button>
          </div>
        )}
      </div>

      {facility.linkedRooms.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {facility.linkedRooms.map((r) => (
            <span key={r.id} className="inline-flex items-center gap-1 rounded bg-brand-50 px-2 py-0.5 text-xs text-brand-800">
              {r.label}
              {canWrite && (
                <button onClick={() => run(() => unlinkFacilityRoomAction(facility.id, r.id))} className="text-red-500" aria-label="فك الربط">×</button>
              )}
            </span>
          ))}
        </div>
      )}

      {canWrite && facility.status !== "غير مطلوب" && (
        <div className="mt-2">
          <button onClick={() => setLinkOpen(!linkOpen)} className="text-xs text-brand-700 underline">
            {linkOpen ? "إغلاق" : "ربط بغرفة فعلية"}
          </button>
          {linkOpen && (
            <form action={linkAction} className="mt-2 flex flex-wrap items-end gap-2">
              {linkState?.error && <div role="alert" className="w-full rounded bg-red-50 p-2 text-xs text-red-700">{linkState.error}</div>}
              <select name="roomId" required className="min-h-11 rounded border border-gray-300 px-2 py-1 text-sm lg:min-h-0">
                <option value="">— اختر غرفة —</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
              <button className="min-h-11 rounded bg-brand-600 px-3 py-1 text-xs text-white lg:min-h-0">ربط</button>
            </form>
          )}
        </div>
      )}

      {facility.notes && <p className="mt-2 text-xs text-gray-500">{facility.notes}</p>}
    </div>
  );
}

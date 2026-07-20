"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ROOM_TYPES,
  roomArea,
  round1,
  validateGeometry,
  type FloorGeometry,
  type GeoRoom,
  type UnplacedRoom,
} from "@/lib/building/geometry";
import { saveGeometryDraftAction } from "../../actions";

/**
 * Phase 6 — محرر مخطط ثنائي الأبعاد يدوي وعملي (ليس CAD/BIM).
 * سير العمل: أنشئ الغرف يدوياً → تظهر في صينية «الغرف غير الموضوعة» → ضعها على المخطط
 * → اسحبها وغيّر أبعادها ورتّبها → مزامنة رقمية↔رسم → حفظ مسودة → نشر نسخة.
 * SVG خفيف مع سحب/تحجيم بمؤشر، شبكة/التقاط/تكبير/تحريك/ملاءمة، تراجع/إعادة، وتنبيهات.
 * التحرير الدقيق للحاسب/اللوحي؛ الجوال عرض فقط (بلا تجاوز أفقي).
 */

const GRID_M = 1; // متر لكل خط شبكة
const SNAP_M = 0.5;
const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : String(Date.now()));

type Draft = { rooms: GeoRoom[]; unplaced: UnplacedRoom[] };

function fromGeometry(g: FloorGeometry): Draft {
  return { rooms: g.rooms ?? [], unplaced: g.unplaced ?? [] };
}

export function ManualEditor({
  floorId,
  initialGeometry,
  canPublish,
}: {
  floorId: string;
  initialGeometry: FloorGeometry;
  canPublish: boolean;
}) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);

  const [draft, setDraft] = useState<Draft>(() => fromGeometry(initialGeometry));
  const [past, setPast] = useState<Draft[]>([]);
  const [future, setFuture] = useState<Draft[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [scale, setScale] = useState(24); // بكسل لكل متر
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [snap, setSnap] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // نموذج إنشاء غرفة
  const [form, setForm] = useState({ name: "", type: ROOM_TYPES[0] as string, w: 4, h: 3, notes: "" });

  // تنبيهات (تداخل/حدود) — تُحسب من التحقق النقي
  const geometry: FloorGeometry = { unit: "m", rooms: draft.rooms, unplaced: draft.unplaced };
  const check = validateGeometry(geometry);

  // commit يلتقط الحالة الحالية «draft» من الإغلاق (deps=[draft]) فيدفعها إلى تاريخ التراجع
  const commit = useCallback(
    (next: Draft) => {
      setPast((p) => [...p.slice(-49), draft]);
      setFuture([]);
      setDraft(next);
      setDirty(true);
    },
    [draft],
  );

  function undo() {
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    setFuture((f) => [draft, ...f]);
    setPast((p) => p.slice(0, -1));
    setDraft(prev);
    setDirty(true);
  }
  function redo() {
    if (future.length === 0) return;
    const nx = future[0];
    setPast((p) => [...p, draft]);
    setFuture((f) => f.slice(1));
    setDraft(nx);
    setDirty(true);
  }

  // منع مغادرة الصفحة مع تغييرات غير محفوظة
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const snapV = (v: number) => (snap ? Math.round(v / SNAP_M) * SNAP_M : round1(v));

  // ——— إنشاء غرفة → صينية غير الموضوعة ———
  function createRoom() {
    const name = form.name.trim();
    if (!name) return setMessage("أدخل اسم الغرفة");
    if (!(form.w > 0) || !(form.h > 0)) return setMessage("أدخل عرضاً وطولاً موجبين");
    const room: UnplacedRoom = { key: uid(), name, type: form.type, w: round1(form.w), h: round1(form.h), notes: form.notes.trim() || undefined };
    commit({ rooms: draft.rooms, unplaced: [...draft.unplaced, room] });
    setForm({ ...form, name: "", notes: "" });
    setMessage(`أُضيفت «${name}» إلى الغرف غير الموضوعة`);
  }

  // ——— وضع غرفة من الصينية على المخطط ———
  function placeRoom(key: string) {
    const u = draft.unplaced.find((r) => r.key === key);
    if (!u) return;
    // موضع افتراضي: أول مكان شاغر بسيط (تدرّج قطري) قرب الأصل
    const n = draft.rooms.length;
    const placed: GeoRoom = { key: u.key, name: u.name, type: u.type, w: u.w, h: u.h, x: round1((n % 5) * (u.w + 1)), y: round1(Math.floor(n / 5) * (u.h + 1)) };
    commit({ rooms: [...draft.rooms, placed], unplaced: draft.unplaced.filter((r) => r.key !== key) });
    setSelected(placed.key);
  }

  function unplaceRoom(key: string) {
    const r = draft.rooms.find((x) => x.key === key);
    if (!r) return;
    const back: UnplacedRoom = { key: r.key, name: r.name, type: r.type, w: r.w, h: r.h };
    commit({ rooms: draft.rooms.filter((x) => x.key !== key), unplaced: [...draft.unplaced, back] });
    if (selected === key) setSelected(null);
  }

  function removeUnplaced(key: string) {
    commit({ rooms: draft.rooms, unplaced: draft.unplaced.filter((r) => r.key !== key) });
  }

  // ——— تعديل رقمي للغرفة المحددة (مزامنة مع الرسم) ———
  function updateRoom(key: string, patch: Partial<GeoRoom>) {
    commit({ ...draft, rooms: draft.rooms.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
  }

  // ——— سحب/تحجيم بمؤشر على SVG ———
  const drag = useRef<{ key: string; mode: "move" | "resize"; startX: number; startY: number; orig: GeoRoom } | null>(null);

  function svgPoint(e: React.PointerEvent): { mx: number; my: number } {
    const rect = svgRef.current!.getBoundingClientRect();
    return { mx: e.clientX - rect.left, my: e.clientY - rect.top };
  }

  function onRoomPointerDown(e: React.PointerEvent, room: GeoRoom, mode: "move" | "resize") {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const { mx, my } = svgPoint(e);
    drag.current = { key: room.key, mode, startX: mx, startY: my, orig: { ...room } };
    setSelected(room.key);
    setPast((p) => [...p.slice(-49), draft]);
    setFuture([]);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const { mx, my } = svgPoint(e);
    const dxm = (mx - drag.current.startX) / scale;
    const dym = (my - drag.current.startY) / scale;
    const o = drag.current.orig;
    setDraft((d) => ({
      ...d,
      rooms: d.rooms.map((r) => {
        if (r.key !== drag.current!.key) return r;
        if (drag.current!.mode === "move") return { ...r, x: snapV(o.x + dxm), y: snapV(o.y + dym) };
        return { ...r, w: Math.max(SNAP_M, snapV(o.w + dxm)), h: Math.max(SNAP_M, snapV(o.h + dym)) };
      }),
    }));
    setDirty(true);
  }
  function onPointerUp() {
    if (drag.current) drag.current = null;
  }

  // ——— تكبير/تحريك/ملاءمة ———
  function fit() {
    if (draft.rooms.length === 0) {
      setScale(24);
      setPan({ x: 40, y: 40 });
      return;
    }
    const maxX = Math.max(...draft.rooms.map((r) => r.x + r.w));
    const maxY = Math.max(...draft.rooms.map((r) => r.y + r.h));
    const minX = Math.min(...draft.rooms.map((r) => r.x));
    const minY = Math.min(...draft.rooms.map((r) => r.y));
    const w = svgRef.current?.clientWidth ?? 600;
    const h = 460;
    const s = Math.max(6, Math.min((w - 80) / (maxX - minX || 1), (h - 80) / (maxY - minY || 1)));
    setScale(Math.min(60, s));
    setPan({ x: 40 - minX * s, y: 40 - minY * s });
  }

  // ——— حفظ المسودة ———
  async function saveDraft() {
    if (!check.ok) {
      setMessage("أصلح الأخطاء قبل الحفظ: " + check.errors.join("؛ "));
      return;
    }
    setSaving(true);
    setMessage(null);
    const res = await saveGeometryDraftAction(floorId, JSON.stringify(geometry));
    setSaving(false);
    if (res?.error) {
      setMessage(res.error);
    } else {
      setDirty(false);
      setMessage(res?.success ?? "حُفظت المسودة");
      router.refresh();
    }
  }

  const selRoom = selected ? draft.rooms.find((r) => r.key === selected) ?? null : null;

  return (
    <div className="space-y-3">
      {message && <div role="status" className="rounded-lg bg-brand-50 p-2 text-sm text-brand-900">{message}</div>}
      {dirty && <div className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">لديك تغييرات غير محفوظة — احفظ المسودة قبل المغادرة.</div>}

      {/* شريط الأدوات */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" onClick={undo} disabled={past.length === 0} className="rounded border px-2 py-1 disabled:opacity-40">تراجع</button>
        <button type="button" onClick={redo} disabled={future.length === 0} className="rounded border px-2 py-1 disabled:opacity-40">إعادة</button>
        <button type="button" onClick={() => setScale((s) => Math.min(60, s + 4))} className="rounded border px-2 py-1">تكبير +</button>
        <button type="button" onClick={() => setScale((s) => Math.max(6, s - 4))} className="rounded border px-2 py-1">تصغير −</button>
        <button type="button" onClick={fit} className="rounded border px-2 py-1">ملاءمة للشاشة</button>
        <label className="flex items-center gap-1"><input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> شبكة</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> التقاط ٠٫٥م</label>
        <button type="button" onClick={saveDraft} disabled={saving} className="rounded-lg bg-brand-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">
          {saving ? "جارٍ الحفظ…" : "حفظ المسودة"}
        </button>
        {canPublish && <span className="text-xs text-gray-400">النشر من «سجل نسخ الهندسة» أسفل الصفحة بعد الحفظ</span>}
      </div>

      {/* تنبيهات */}
      {(check.errors.length > 0 || check.warnings.length > 0) && (
        <div className="rounded-lg border border-sand-200 bg-white p-2 text-xs">
          {check.errors.map((e, i) => <div key={`e${i}`} className="text-red-700">⛔ {e}</div>)}
          {check.warnings.map((w, i) => <div key={`w${i}`} className="text-amber-700">⚠ {w}</div>)}
        </div>
      )}

      <div className="flex flex-col gap-3 lg:flex-row">
        {/* اللوحة الجانبية: إنشاء + صينية + تعديل رقمي */}
        <div className="w-full space-y-3 lg:w-80">
          <div className="rounded-xl border border-sand-200 bg-white p-3">
            <h3 className="mb-2 text-sm font-bold text-gray-700">إنشاء غرفة</h3>
            <div className="space-y-2 text-sm">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="اسم الغرفة" className="w-full rounded border border-gray-300 px-2 py-1" />
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full rounded border border-gray-300 bg-white px-2 py-1">
                {ROOM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <div className="flex gap-2">
                <label className="flex-1 text-xs">العرض (م)<input type="number" step="0.5" min="0.5" value={form.w} onChange={(e) => setForm({ ...form, w: Number(e.target.value) })} className="w-full rounded border border-gray-300 px-2 py-1" /></label>
                <label className="flex-1 text-xs">الطول (م)<input type="number" step="0.5" min="0.5" value={form.h} onChange={(e) => setForm({ ...form, h: Number(e.target.value) })} className="w-full rounded border border-gray-300 px-2 py-1" /></label>
              </div>
              <p className="text-xs text-gray-400">المساحة المحسوبة: {roomArea({ w: form.w || 0, h: form.h || 0 })} م²</p>
              <button type="button" onClick={createRoom} className="w-full rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-medium text-white">إضافة غرفة</button>
            </div>
          </div>

          <div className="rounded-xl border border-sand-200 bg-white p-3">
            <h3 className="mb-2 text-sm font-bold text-gray-700">الغرف غير الموضوعة ({draft.unplaced.length})</h3>
            {draft.unplaced.length === 0 ? (
              <p className="text-xs text-gray-400">أنشئ غرفة لتظهر هنا، ثم ضعها على المخطط.</p>
            ) : (
              <ul className="space-y-1">
                {draft.unplaced.map((r) => (
                  <li key={r.key} className="flex items-center justify-between gap-1 rounded border border-sand-100 bg-sand-50 px-2 py-1 text-xs">
                    <span>{r.name} <span className="text-gray-400">({r.w}×{r.h}م)</span></span>
                    <span className="flex gap-1">
                      <button type="button" onClick={() => placeRoom(r.key)} className="rounded bg-brand-600 px-2 py-0.5 text-white">ضع في المخطط</button>
                      <button type="button" onClick={() => removeUnplaced(r.key)} className="rounded border border-red-300 px-1 text-red-700">حذف</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {selRoom && (
            <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-3">
              <h3 className="mb-2 text-sm font-bold text-brand-900">تعديل: {selRoom.name}</h3>
              <div className="space-y-2 text-sm">
                <input value={selRoom.name} onChange={(e) => updateRoom(selRoom.key, { name: e.target.value })} className="w-full rounded border border-gray-300 px-2 py-1" />
                <select value={selRoom.type} onChange={(e) => updateRoom(selRoom.key, { type: e.target.value })} className="w-full rounded border border-gray-300 bg-white px-2 py-1">
                  {ROOM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <div className="flex gap-2">
                  <label className="flex-1 text-xs">العرض (م)<input type="number" step="0.5" min="0.5" value={selRoom.w} onChange={(e) => updateRoom(selRoom.key, { w: round1(Number(e.target.value)) })} className="w-full rounded border border-gray-300 px-2 py-1" /></label>
                  <label className="flex-1 text-xs">الطول (م)<input type="number" step="0.5" min="0.5" value={selRoom.h} onChange={(e) => updateRoom(selRoom.key, { h: round1(Number(e.target.value)) })} className="w-full rounded border border-gray-300 px-2 py-1" /></label>
                </div>
                <p className="text-xs text-gray-400">المساحة: {roomArea(selRoom)} م²</p>
                <div className="flex gap-1">
                  <button type="button" onClick={() => unplaceRoom(selRoom.key)} className="rounded border px-2 py-1 text-xs">إعادة للصينية</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* المخطط */}
        <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-sand-200 bg-white">
          <div className="hidden lg:block">
            <svg
              ref={svgRef}
              className="h-[460px] w-full touch-none select-none"
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              onClick={(e) => {
                // إلغاء التحديد فقط عند النقر على خلفية المخطط لا على غرفة
                if (e.target === e.currentTarget) setSelected(null);
              }}
            >
              {showGrid && (
                <g stroke="#eee">
                  {Array.from({ length: 60 }).map((_, i) => (
                    <line key={`v${i}`} x1={pan.x + i * GRID_M * scale} y1={0} x2={pan.x + i * GRID_M * scale} y2={460} />
                  ))}
                  {Array.from({ length: 30 }).map((_, i) => (
                    <line key={`h${i}`} x1={0} y1={pan.y + i * GRID_M * scale} x2={2000} y2={pan.y + i * GRID_M * scale} />
                  ))}
                </g>
              )}
              {draft.rooms.map((r) => {
                const px = pan.x + r.x * scale;
                const py = pan.y + r.y * scale;
                const pw = r.w * scale;
                const ph = r.h * scale;
                const isSel = r.key === selected;
                return (
                  <g key={r.key}>
                    <rect
                      x={px}
                      y={py}
                      width={pw}
                      height={ph}
                      rx={2}
                      fill={isSel ? "#c7d2fe" : "#e5efe9"}
                      stroke={isSel ? "#4338ca" : "#348066"}
                      strokeWidth={isSel ? 2 : 1}
                      className="cursor-move"
                      onPointerDown={(e) => onRoomPointerDown(e, r, "move")}
                    />
                    <text x={px + pw / 2} y={py + ph / 2} textAnchor="middle" dominantBaseline="middle" fontSize={11} fill="#1f5244" pointerEvents="none">
                      {r.name}
                    </text>
                    <text x={px + pw / 2} y={py + ph / 2 + 13} textAnchor="middle" fontSize={9} fill="#6b7280" pointerEvents="none">
                      {r.w}×{r.h}م
                    </text>
                    {/* مقبض التحجيم (الركن السفلي) */}
                    <rect
                      x={px + pw - 8}
                      y={py + ph - 8}
                      width={10}
                      height={10}
                      fill="#4338ca"
                      className="cursor-nwse-resize"
                      onPointerDown={(e) => onRoomPointerDown(e, r, "resize")}
                    />
                  </g>
                );
              })}
            </svg>
          </div>
          {/* الجوال: عرض فقط */}
          <div className="p-4 text-sm text-gray-600 lg:hidden">
            تحرير المخطط بدقة متاح على الحاسب أو الجهاز اللوحي. على الجوال يمكنك عرض المخطط المنشور من صفحة المبنى، وإدخال بيانات الغرف رقمياً من صفحة الغرفة.
            {draft.rooms.length > 0 && <p className="mt-2 text-xs text-gray-400">هذا المخطط يحوي {draft.rooms.length} غرفة موضوعة و{draft.unplaced.length} غير موضوعة.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

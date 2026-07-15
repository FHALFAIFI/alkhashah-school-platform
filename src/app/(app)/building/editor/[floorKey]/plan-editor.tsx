"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import type Konva from "konva";
import { Stage, Layer, Rect, Text, Group, Image as KImage, Circle } from "react-konva";
import {
  saveGeometryDraftAction, publishGeometryAction, updateBackgroundTransformAction, replaceBackgroundAction,
  type ActionState,
} from "../../actions";
import { roomArea, roomPerimeter, round1, ROOM_TYPES, type FloorGeometry, type GeoRoom } from "@/lib/building/geometry";
import { SubmitButton } from "@/components/ui";
import { useActionState } from "react";

const SCALE = 16; // بكسل لكل متر

type Background = {
  id: string;
  url: string;
  transform: { x: number; y: number; scale: number; rotation: number; opacity: number; visible: boolean };
};

const TYPE_COLORS: Record<string, string> = {
  "فصل دراسي": "#d8ece2",
  "معمل": "#dbe7f6",
  "مكتب إداري": "#f6ecd4",
  "غرفة معلمين": "#e8ddf0",
  "مصادر تعلم": "#e8ddf0",
  "ممر": "#f2f0eb",
  "سلم": "#e5e1d8",
  "دورة مياه": "#dcedf0",
  "خدمات": "#dcedf0",
  "ملعب": "#cfe8cf",
  "ساحة": "#eee9db",
  "مخرج طوارئ": "#f6d4d4",
  "بوابة": "#f6d4d4",
};

export function PlanEditor({
  floorId,
  floorName,
  isSite,
  isContext,
  initialGeometry,
  latestVersion,
  latestVersionId,
  latestStatus,
  background,
  canPublish,
}: {
  floorId: string;
  floorName: string;
  isSite: boolean;
  isContext: boolean;
  initialGeometry: FloorGeometry;
  latestVersion: number;
  latestVersionId: string | null;
  latestStatus: string;
  background: Background | null;
  canPublish: boolean;
}) {
  const [geometry, setGeometry] = useState<FloorGeometry>(initialGeometry);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [history, setHistory] = useState<FloorGeometry[]>([initialGeometry]);
  const [historyIdx, setHistoryIdx] = useState(0);
  const [bg, setBg] = useState<Background | null>(background);
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [bgMode, setBgMode] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const stageRef = useRef<Konva.Stage>(null);

  useEffect(() => {
    if (!bg) return;
    const img = new window.Image();
    img.src = bg.url;
    img.onload = () => setBgImage(img);
  }, [bg?.url, bg]);

  const pushHistory = useCallback(
    (next: FloorGeometry) => {
      setGeometry(next);
      setHistory((h) => [...h.slice(0, historyIdx + 1), next].slice(-50));
      setHistoryIdx((i) => Math.min(i + 1, 49));
    },
    [historyIdx],
  );

  const undo = useCallback(() => {
    if (historyIdx > 0) {
      setHistoryIdx(historyIdx - 1);
      setGeometry(history[historyIdx - 1]);
    }
  }, [history, historyIdx]);

  const redo = useCallback(() => {
    if (historyIdx < history.length - 1) {
      setHistoryIdx(historyIdx + 1);
      setGeometry(history[historyIdx + 1]);
    }
  }, [history, historyIdx]);

  const selected = useMemo(() => geometry.rooms.find((r) => r.key === selectedKey) ?? null, [geometry, selectedKey]);

  const updateRoom = useCallback(
    (key: string, patch: Partial<GeoRoom>) => {
      pushHistory({
        ...geometry,
        rooms: geometry.rooms.map((r) => (r.key === key ? { ...r, ...patch } : r)),
      });
    },
    [geometry, pushHistory],
  );

  const addRoom = useCallback(() => {
    const key = `room-${Date.now().toString(36)}`;
    pushHistory({
      ...geometry,
      rooms: [...geometry.rooms, { key, name: "غرفة جديدة", type: "أخرى", x: 2, y: 2, w: 5, h: 4 }],
    });
    setSelectedKey(key);
  }, [geometry, pushHistory]);

  const deleteRoom = useCallback(() => {
    if (!selectedKey) return;
    pushHistory({ ...geometry, rooms: geometry.rooms.filter((r) => r.key !== selectedKey) });
    setSelectedKey(null);
  }, [geometry, pushHistory, selectedKey]);

  const addDoor = useCallback(() => {
    if (!selected) return;
    const doors = [...(selected.doors ?? []), { side: "bottom" as const, offset: round1(selected.w / 2) }];
    updateRoom(selected.key, { doors });
  }, [selected, updateRoom]);

  const saveDraft = () =>
    startTransition(async () => {
      setMessage(null);
      const res = await saveGeometryDraftAction(floorId, JSON.stringify(geometry));
      setMessage(res?.error ? { kind: "err", text: res.error } : { kind: "ok", text: res?.success ?? "حفظ" });
    });

  const publish = () =>
    startTransition(async () => {
      setMessage(null);
      // احفظ مسودة أولاً ثم انشرها؟ النشر يكون لآخر نسخة محفوظة
      const res = await saveGeometryDraftAction(floorId, JSON.stringify(geometry));
      if (res?.error) {
        setMessage({ kind: "err", text: res.error });
        return;
      }
      // أعد تحميل الصفحة ليظهر زر نشر النسخة الجديدة
      window.location.reload();
    });

  const saveBgTransform = () => {
    if (!bg) return;
    startTransition(async () => {
      await updateBackgroundTransformAction(bg.id, JSON.stringify(bg.transform));
      setMessage({ kind: "ok", text: "حفظ تحويل الخلفية (الهندسة لم تتغير)" });
    });
  };

  const canvasW = 900;
  const canvasH = 560;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
      <div>
        <div className="no-print mb-2 flex flex-wrap items-center gap-2">
          <button onClick={addRoom} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm text-white">إضافة غرفة</button>
          <button onClick={deleteRoom} disabled={!selectedKey} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 disabled:opacity-40">حذف المحددة</button>
          <button onClick={undo} disabled={historyIdx === 0} className="rounded-lg border border-sand-200 px-3 py-1.5 text-sm disabled:opacity-40">تراجع</button>
          <button onClick={redo} disabled={historyIdx >= history.length - 1} className="rounded-lg border border-sand-200 px-3 py-1.5 text-sm disabled:opacity-40">إعادة</button>
          <span className="mx-2 border-s border-sand-200" />
          <button onClick={saveDraft} disabled={pending} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">حفظ مسودة (نسخة جديدة)</button>
          {bg && (
            <>
              <button
                onClick={() => setBg({ ...bg, transform: { ...bg.transform, visible: !bg.transform.visible } })}
                className="rounded-lg border border-sand-200 px-3 py-1.5 text-sm"
              >
                {bg.transform.visible ? "إخفاء الخلفية" : "إظهار الخلفية"}
              </button>
              <button
                onClick={() => setBgMode(!bgMode)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${bgMode ? "border-purple-400 bg-purple-50 text-purple-800" : "border-sand-200"}`}
              >
                {bgMode ? "وضع تحرير الخلفية ✓" : "تحرير الخلفية"}
              </button>
            </>
          )}
        </div>
        {message && (
          <div role={message.kind === "err" ? "alert" : "status"} className={`mb-2 rounded-lg p-2 text-sm ${message.kind === "err" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
            {message.text}
          </div>
        )}
        <div className="overflow-auto rounded-xl border border-sand-200 bg-white" style={{ direction: "ltr" }}>
          <Stage
            ref={stageRef}
            width={canvasW}
            height={canvasH}
            onMouseDown={(e) => {
              if (e.target === e.target.getStage()) setSelectedKey(null);
            }}
          >
            <Layer>
              {bg && bgImage && bg.transform.visible && (
                <KImage
                  image={bgImage}
                  x={bg.transform.x * SCALE}
                  y={bg.transform.y * SCALE}
                  scaleX={bg.transform.scale * SCALE}
                  scaleY={bg.transform.scale * SCALE}
                  rotation={bg.transform.rotation}
                  opacity={bg.transform.opacity}
                  draggable={bgMode}
                  onDragEnd={(e) => {
                    setBg({ ...bg, transform: { ...bg.transform, x: round1(e.target.x() / SCALE), y: round1(e.target.y() / SCALE) } });
                  }}
                />
              )}
              {/* عناصر السياق (مجمع البنات) — باهتة وغير قابلة للتحديد */}
              {(geometry.contextShapes ?? []).map((c) => (
                <Group key={c.key} x={c.x * SCALE + 60} y={(c.y + 20) * SCALE}>
                  <Rect width={c.w * SCALE} height={c.h * SCALE} fill="#eeeeee" opacity={0.5} stroke="#cccccc" dash={[6, 4]} />
                  <Text text={c.name} width={c.w * SCALE} y={c.h * SCALE / 2 - 8} align="center" fontSize={12} fill="#999999" />
                </Group>
              ))}
              {geometry.rooms.map((room) => {
                const isSelected = room.key === selectedKey;
                const offsetY = isSite ? 20 * SCALE : 40;
                return (
                  <Group
                    key={room.key}
                    x={room.x * SCALE + 60}
                    y={room.y * SCALE + offsetY}
                    draggable={!bgMode}
                    onDragEnd={(e) => {
                      updateRoom(room.key, { x: round1((e.target.x() - 60) / SCALE), y: round1((e.target.y() - offsetY) / SCALE) });
                    }}
                    onClick={() => setSelectedKey(room.key)}
                    onTap={() => setSelectedKey(room.key)}
                  >
                    <Rect
                      width={room.w * SCALE}
                      height={room.h * SCALE}
                      fill={TYPE_COLORS[room.type] ?? "#f5f3ee"}
                      stroke={isSelected ? "#256652" : "#8a8578"}
                      strokeWidth={isSelected ? 2.5 : 1}
                      opacity={0.92}
                    />
                    {(room.doors ?? []).map((d, i) => {
                      const pos =
                        d.side === "top" ? { x: d.offset * SCALE, y: 0 } :
                        d.side === "bottom" ? { x: d.offset * SCALE, y: room.h * SCALE } :
                        d.side === "left" ? { x: 0, y: d.offset * SCALE } :
                        { x: room.w * SCALE, y: d.offset * SCALE };
                      return <Circle key={i} x={pos.x} y={pos.y} radius={4} fill="#256652" />;
                    })}
                    <Text
                      text={room.name}
                      width={room.w * SCALE}
                      y={room.h * SCALE / 2 - 14}
                      align="center"
                      fontSize={12}
                      fontStyle="bold"
                      fill="#1b4238"
                    />
                    <Text
                      text={`${round1(room.w)}×${round1(room.h)}م`}
                      width={room.w * SCALE}
                      y={room.h * SCALE / 2 + 2}
                      align="center"
                      fontSize={10}
                      fill="#6b675c"
                    />
                    {isSelected && (
                      <Circle
                        x={room.w * SCALE}
                        y={room.h * SCALE}
                        radius={6}
                        fill="#256652"
                        draggable
                        onDragMove={(e) => {
                          const newW = Math.max(1, round1(e.target.x() / SCALE));
                          const newH = Math.max(1, round1(e.target.y() / SCALE));
                          e.target.position({ x: newW * SCALE, y: newH * SCALE });
                          updateRoom(room.key, { w: newW, h: newH });
                        }}
                      />
                    )}
                  </Group>
                );
              })}
            </Layer>
          </Stage>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          مخطط تشغيلي وليس رسماً هندسياً معتمداً · اسحب الغرفة لتحريكها، واسحب المقبض الأخضر لتغيير الأبعاد (يحدث الطول والعرض تلقائياً) · النسخة الحالية: {latestVersion} ({latestStatus})
        </p>
      </div>

      <div className="no-print space-y-4">
        {selected ? (
          <div className="rounded-xl border border-sand-200 bg-white p-4">
            <h2 className="mb-3 font-bold text-brand-900">الغرفة المحددة</h2>
            <div className="space-y-3 text-sm">
              <div>
                <label className="mb-1 block text-xs text-gray-500">الاسم</label>
                <input
                  value={selected.name}
                  onChange={(e) => updateRoom(selected.key, { name: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">النوع</label>
                <select
                  value={selected.type}
                  onChange={(e) => updateRoom(selected.key, { type: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm"
                >
                  {ROOM_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs text-gray-500">الطول (م)</label>
                  <input
                    type="number"
                    step={0.1}
                    min={0.5}
                    value={selected.w}
                    onChange={(e) => updateRoom(selected.key, { w: Math.max(0.5, round1(Number(e.target.value))) })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">العرض (م)</label>
                  <input
                    type="number"
                    step={0.1}
                    min={0.5}
                    value={selected.h}
                    onChange={(e) => updateRoom(selected.key, { h: Math.max(0.5, round1(Number(e.target.value))) })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm tabular-nums"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500 tabular-nums">
                المساحة: {roomArea(selected)} م² · المحيط: {roomPerimeter(selected)} م
                <span className="block text-gray-400">(تحسب تلقائياً — إدخال البعد يغير الرسم والسحب يحدث الأبعاد)</span>
              </p>
              <button onClick={addDoor} className="rounded-lg border border-sand-200 px-3 py-1.5 text-xs">إضافة باب</button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-sand-300 bg-white p-4 text-sm text-gray-400">
            اختر غرفة من المخطط لتحرير اسمها وأبعادها
          </div>
        )}

        {bg && bgMode && (
          <div className="rounded-xl border border-purple-200 bg-purple-50/50 p-4 text-sm">
            <h2 className="mb-2 font-bold text-purple-900">تحرير الخلفية (لا يمس الهندسة)</h2>
            <label className="mb-1 block text-xs text-gray-500">المقياس</label>
            <input
              type="range"
              min={0.005}
              max={0.15}
              step={0.001}
              value={bg.transform.scale}
              onChange={(e) => setBg({ ...bg, transform: { ...bg.transform, scale: Number(e.target.value) } })}
              className="w-full"
            />
            <label className="mb-1 mt-2 block text-xs text-gray-500">الدوران (درجة)</label>
            <input
              type="number"
              value={bg.transform.rotation}
              onChange={(e) => setBg({ ...bg, transform: { ...bg.transform, rotation: Number(e.target.value) } })}
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm tabular-nums"
            />
            <label className="mb-1 mt-2 block text-xs text-gray-500">الشفافية</label>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={bg.transform.opacity}
              onChange={(e) => setBg({ ...bg, transform: { ...bg.transform, opacity: Number(e.target.value) } })}
              className="w-full"
            />
            <button onClick={saveBgTransform} disabled={pending} className="mt-3 rounded-lg bg-purple-700 px-3 py-1.5 text-sm text-white">
              حفظ تحويل الخلفية
            </button>
            <ReplaceBackgroundForm floorId={floorId} />
          </div>
        )}

        <div className="rounded-xl border border-sand-200 bg-white p-4">
          <h2 className="mb-2 font-bold text-brand-900">النشر</h2>
          <p className="mb-2 text-xs text-gray-500">
            احفظ مسودة ثم انشرها من قائمة النسخ في صفحة المخطط. النشر يزامن سجل الغرف ويحفظ التاريخ الكامل للنسخ.
          </p>
          {canPublish && latestVersionId && latestStatus === "مسودة" && (
            <PublishButton versionId={latestVersionId} version={latestVersion} />
          )}
        </div>
      </div>
    </div>
  );
}

function PublishButton({ versionId, version }: { versionId: string; version: number }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      {error && <div role="alert" className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</div>}
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await publishGeometryAction(versionId);
            if (res?.error) setError(res.error);
            else window.location.reload();
          })
        }
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        نشر النسخة {version} ومزامنة سجل الغرف
      </button>
    </div>
  );
}

function ReplaceBackgroundForm({ floorId }: { floorId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(replaceBackgroundAction.bind(null, floorId), null);
  return (
    <form action={formAction} className="mt-3 border-t border-purple-200 pt-3">
      {state?.error && <div role="alert" className="mb-1 rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="mb-1 rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      <label className="mb-1 block text-xs text-gray-500">استبدال الخلفية (صورة محلية — لا يغير الهندسة)</label>
      <input name="file" type="file" accept=".png,.jpg,.jpeg,.webp" className="mb-2 w-full text-xs" />
      <SubmitButton variant="secondary">رفع واستبدال</SubmitButton>
    </form>
  );
}

export default PlanEditor;

"use client";

import { useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { FloorGeometry } from "@/lib/building/geometry";
import { round1 } from "@/lib/building/geometry";

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
  "مظلة": "#f0e6d0",
};

const MIN_SCALE = 1;
const MAX_SCALE = 8;

/**
 * عارض المخطط التفاعلي — يتكيف مع عرض الشاشة، ويدعم التقريب بالقرص (إصبعان)
 * والسحب عند التقريب، دون مصادرة تمرير الصفحة العادي (إصبع واحد يمرر الصفحة ما لم يكن المخطط مقرباً).
 */
export function FloorViewer({
  geometry,
  roomLinks,
}: {
  geometry: FloorGeometry;
  roomLinks?: Record<string, string>;
}) {
  const router = useRouter();
  const S = 14;
  const allShapes = [
    ...geometry.rooms.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
    ...(geometry.contextShapes ?? []),
  ];
  const minX = Math.min(...allShapes.map((s) => s.x), 0);
  const minY = Math.min(...allShapes.map((s) => s.y), 0);
  const maxX = Math.max(...allShapes.map((s) => s.x + s.w), 10);
  const maxY = Math.max(...allShapes.map((s) => s.y + s.h), 10);
  const width = (maxX - minX + 4) * S;
  const height = (maxY - minY + 4) * S;
  const tx = (x: number) => (x - minX + 2) * S;
  const ty = (y: number) => (y - minY + 2) * S;

  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; scale: number; x: number; y: number; cx: number; cy: number } | null>(null);
  const moved = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const clampView = useCallback((v: { scale: number; x: number; y: number }) => {
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale));
    const el = containerRef.current;
    if (!el) return { ...v, scale };
    const w = el.clientWidth;
    const h = el.clientHeight;
    const maxPan = (scale - 1) / 2;
    return {
      scale,
      x: Math.min(w * maxPan, Math.max(-w * maxPan, v.x)),
      y: Math.min(h * maxPan, Math.max(-h * maxPan, v.y)),
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        scale: view.scale,
        x: view.x,
        y: view.y,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
      };
    } else if (pointers.current.size === 1 && view.scale > 1) {
      gesture.current = { dist: 0, scale: view.scale, x: view.x, y: view.y, cx: e.clientX, cy: e.clientY };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (pointers.current.size === 2) {
      e.preventDefault();
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const factor = g.dist > 0 ? dist / g.dist : 1;
      moved.current = true;
      setView(clampView({ scale: g.scale * factor, x: g.x, y: g.y }));
    } else if (pointers.current.size === 1 && view.scale > 1) {
      const dx = e.clientX - g.cx;
      const dy = e.clientY - g.cy;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved.current = true;
      setView(clampView({ scale: g.scale, x: g.x + dx, y: g.y + dy }));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    if (pointers.current.size === 1 && view.scale > 1) {
      const [p] = [...pointers.current.values()];
      gesture.current = { dist: 0, scale: view.scale, x: view.x, y: view.y, cx: p.x, cy: p.y };
    }
  };

  const zoomBy = (factor: number) => setView((v) => clampView({ ...v, scale: v.scale * factor }));
  const reset = () => setView({ scale: 1, x: 0, y: 0 });

  const openRoom = (key: string) => {
    if (moved.current) return;
    const href = roomLinks?.[key];
    if (href) router.push(href);
  };

  return (
    <div className="relative">
      {/* أزرار التحكم: تقريب، إبعاد، إعادة الضبط */}
      <div className="absolute end-2 top-2 z-10 flex flex-col gap-1">
        <button aria-label="تقريب" onClick={() => zoomBy(1.4)} className="flex h-11 w-11 items-center justify-center rounded-lg border border-sand-200 bg-white/95 text-lg shadow-sm">+</button>
        <button aria-label="إبعاد" onClick={() => zoomBy(1 / 1.4)} className="flex h-11 w-11 items-center justify-center rounded-lg border border-sand-200 bg-white/95 text-lg shadow-sm">−</button>
        <button aria-label="إعادة ضبط العرض" onClick={reset} className="flex h-11 w-11 items-center justify-center rounded-lg border border-sand-200 bg-white/95 text-sm shadow-sm">⟲</button>
      </div>
      <div
        ref={containerRef}
        dir="ltr"
        className="overflow-hidden rounded-lg bg-sand-50"
        style={{ touchAction: view.scale > 1 ? "none" : "pan-y pinch-zoom" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="block h-auto w-full select-none"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transformOrigin: "center center",
            transition: gesture.current ? "none" : "transform 120ms ease-out",
          }}
        >
          {(geometry.contextShapes ?? []).map((c) => (
            <g key={c.key}>
              <rect x={tx(c.x)} y={ty(c.y)} width={c.w * S} height={c.h * S} fill="#e8e8e8" stroke="#cccccc" strokeDasharray="6 4" opacity={0.55} />
              <text x={tx(c.x) + (c.w * S) / 2} y={ty(c.y) + (c.h * S) / 2} textAnchor="middle" fontSize={11} fill="#9a9a9a">
                {c.name}
              </text>
            </g>
          ))}
          {geometry.rooms.map((r) => (
            <g
              key={r.key}
              onClick={() => openRoom(r.key)}
              style={roomLinks?.[r.key] ? { cursor: "pointer" } : undefined}
              role={roomLinks?.[r.key] ? "link" : undefined}
              aria-label={roomLinks?.[r.key] ? `فتح غرفة ${r.name}` : undefined}
            >
              <rect
                x={tx(r.x)}
                y={ty(r.y)}
                width={r.w * S}
                height={r.h * S}
                fill={TYPE_COLORS[r.type] ?? "#f5f3ee"}
                stroke="#8a8578"
                strokeWidth={1}
              />
              {(r.doors ?? []).map((d, i) => {
                const px = d.side === "left" ? tx(r.x) : d.side === "right" ? tx(r.x) + r.w * S : tx(r.x) + d.offset * S;
                const py = d.side === "top" ? ty(r.y) : d.side === "bottom" ? ty(r.y) + r.h * S : ty(r.y) + d.offset * S;
                return <circle key={i} cx={px} cy={py} r={3} fill="#256652" />;
              })}
              <text x={tx(r.x) + (r.w * S) / 2} y={ty(r.y) + (r.h * S) / 2 - 3} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="#1b4238">
                {r.name}
              </text>
              <text x={tx(r.x) + (r.w * S) / 2} y={ty(r.y) + (r.h * S) / 2 + 10} textAnchor="middle" fontSize={9} fill="#6b675c">
                {round1(r.w)}×{round1(r.h)}م
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FloorGeometry } from "@/lib/building/geometry";
import { round1 } from "@/lib/building/geometry";
import {
  type ViewerView, type ViewBase, type BBox,
  VIEWER_ZOOM_STEP, initialView, viewBoxOf, zoomCentered, zoomAtPoint, panBy, fitToContent,
} from "@/lib/building/viewer-view";

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

/**
 * عارض المخطط التفاعلي — التقريب والسحب عبر `viewBox` مباشرةً (وحدات SVG) فلا انحراف
 * لمركز التقريب. يدعم: أزرار + / − / ملاءمة / إعادة ضبط، عجلة الفأرة، القرص بإصبعين،
 * والسحب بعد التقريب — دون مصادرة تمرير الصفحة (إصبع واحد يمرر الصفحة ما لم يكن المخطط مقرباً).
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

  const base: ViewBase = useMemo(() => ({ w: width, h: height }), [width, height]);
  // صندوق المحتوى الفعلي (دون الهوامش المحيطة) — لزر «ملاءمة المخطط للشاشة»
  const contentBBox: BBox = (() => {
    if (allShapes.length === 0) return { x: 0, y: 0, w: width, h: height };
    const x0 = Math.min(...allShapes.map((s) => s.x));
    const y0 = Math.min(...allShapes.map((s) => s.y));
    const x1 = Math.max(...allShapes.map((s) => s.x + s.w));
    const y1 = Math.max(...allShapes.map((s) => s.y + s.h));
    return { x: tx(x0), y: ty(y0), w: (x1 - x0) * S, h: (y1 - y0) * S };
  })();

  const [view, setView] = useState<ViewerView>(() => initialView(base));
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { type: "pan"; view: ViewerView; x: number; y: number }
    | { type: "pinch"; view: ViewerView; dist: number; x: number; y: number }
    | null
  >(null);
  const moved = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // عجلة الفأرة/لوحة اللمس: تقريب حول موضع المؤشر. مستمع أصلي غير passive لأن React
  // يسجّل onWheel بوضع passive فلا يعمل معه preventDefault (يلزم لمنع تمرير الصفحة).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const factor = Math.exp(-dy * 0.0015);
      setView((v) => zoomAtPoint(v, base, factor, e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [base]);

  const capture = (el: Element | null, pointerId: number) => {
    try {
      el?.setPointerCapture?.(pointerId);
    } catch {
      // المؤشر انتهى قبل الالتقاط — لا شيء يلزم
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        type: "pinch",
        view,
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
      };
      // التقاط كلا المؤشرين على الحاوية كي لا تنقطع الإيماءة إن خرجت الأصابع عن الإطار
      for (const id of pointers.current.keys()) capture(containerRef.current, id);
    } else if (pointers.current.size === 1 && view.scale > 1) {
      gesture.current = { type: "pan", view, x: e.clientX, y: e.clientY };
      // الالتقاط على الهدف نفسه (لا الحاوية) يبقي نقرة الغرفة تعمل بعد الالتقاط
      capture(e.target as Element, e.pointerId);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const el = containerRef.current;
    if (!g || !el) return;
    const rect = el.getBoundingClientRect();
    if (g.type === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const factor = g.dist > 0 ? dist / g.dist : 1;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      moved.current = true;
      let v = zoomAtPoint(g.view, base, factor, g.x - rect.left, g.y - rect.top, rect.width, rect.height);
      v = panBy(v, base, mx - g.x, my - g.y, rect.width, rect.height);
      setView(v);
    } else if (g.type === "pan") {
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved.current = true;
      setView(panBy(g.view, base, dx, dy, rect.width, rect.height));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2 && gesture.current?.type === "pinch") gesture.current = null;
    if (pointers.current.size === 0) gesture.current = null;
    if (pointers.current.size === 1 && gesture.current === null && view.scale > 1) {
      const [p] = [...pointers.current.values()];
      gesture.current = { type: "pan", view, x: p.x, y: p.y };
    }
  };

  // مؤشر غادر الإطار دون إيماءة فعالة (زر أُفلت خارج الإطار مثلاً) — يُنسى فوراً،
  // وإلا بقي «مؤشراً شبحياً» يجعل اللمسة التالية تُحسب قرصاً ويعطّل فتح الغرف.
  const onPointerLeave = (e: React.PointerEvent) => {
    if (!gesture.current) pointers.current.delete(e.pointerId);
  };

  const openRoom = (key: string) => {
    if (moved.current) return;
    const href = roomLinks?.[key];
    if (href) router.push(href);
  };

  const controls: { label: string; glyph: string; onClick: () => void; testId: string }[] = [
    { label: "تقريب", glyph: "+", onClick: () => setView((v) => zoomCentered(v, base, VIEWER_ZOOM_STEP)), testId: "viewer-zoom-in" },
    { label: "إبعاد", glyph: "−", onClick: () => setView((v) => zoomCentered(v, base, 1 / VIEWER_ZOOM_STEP)), testId: "viewer-zoom-out" },
    { label: "ملاءمة المخطط للشاشة", glyph: "⛶", onClick: () => setView(fitToContent(base, contentBBox, S)), testId: "viewer-fit" },
    { label: "إعادة ضبط العرض", glyph: "⟲", onClick: () => setView(initialView(base)), testId: "viewer-reset" },
  ];

  return (
    <div className="relative">
      {/* أزرار التحكم أسفل المخطط كي لا تنزلق تحت الشريط العلوي الثابت عند التمرير */}
      <div className="absolute bottom-2 end-2 z-10 flex flex-col gap-1">
        {controls.map((c) => (
          <button
            key={c.testId}
            type="button"
            aria-label={c.label}
            title={c.label}
            data-testid={c.testId}
            onClick={c.onClick}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-sand-200 bg-white/95 text-lg shadow-sm hover:bg-sand-50"
          >
            {c.glyph}
          </button>
        ))}
      </div>
      <div
        ref={containerRef}
        dir="ltr"
        className="overflow-hidden rounded-lg bg-sand-50"
        style={{ touchAction: view.scale > 1 ? "none" : "pan-y" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onPointerUp}
        onPointerLeave={onPointerLeave}
      >
        <svg viewBox={viewBoxOf(view, base)} className="block h-auto w-full select-none" style={{ aspectRatio: `${width} / ${height}` }}>
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

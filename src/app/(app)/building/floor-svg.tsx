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

/** عرض ثنائي الأبعاد للقراءة — SVG من الهندسة المخزنة نفسها */
export function FloorSvg({ geometry, isSite }: { geometry: FloorGeometry; isSite: boolean }) {
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

  return (
    <div className="overflow-x-auto" dir="ltr">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="max-w-none rounded-lg bg-sand-50">
        {(geometry.contextShapes ?? []).map((c) => (
          <g key={c.key}>
            <rect x={tx(c.x)} y={ty(c.y)} width={c.w * S} height={c.h * S} fill="#e8e8e8" stroke="#cccccc" strokeDasharray="6 4" opacity={0.55} />
            <text x={tx(c.x) + (c.w * S) / 2} y={ty(c.y) + (c.h * S) / 2} textAnchor="middle" fontSize={11} fill="#9a9a9a">
              {c.name}
            </text>
          </g>
        ))}
        {geometry.rooms.map((r) => (
          <g key={r.key}>
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
  );
}

"use client";

import dynamic from "next/dynamic";
import type { FloorGeometry } from "@/lib/building/geometry";

const LazyIso = dynamic(() => import("./iso-view"), {
  ssr: false,
  loading: () => <div className="p-10 text-center text-sm text-gray-400">جارٍ تحميل العرض ثلاثي الأبعاد…</div>,
});

export function IsoLoader({ floors }: { floors: { key: string; nameAr: string; level: number; geometry: FloorGeometry }[] }) {
  return <LazyIso floors={floors} />;
}

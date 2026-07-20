/**
 * نموذج هندسة المخطط — وحدة القياس المتر، والعرض بمنزلة عشرية واحدة.
 * المخطط تشغيلي وليس رسماً هندسياً معتمداً.
 */

export type GeoRoom = {
  key: string;
  name: string;
  type: string;
  x: number;
  y: number;
  /** الطول على المحور الأفقي بالمتر */
  w: number;
  /** العرض على المحور الرأسي بالمتر */
  h: number;
  doors?: { side: "top" | "bottom" | "left" | "right"; offset: number }[];
};

/** غرفة أُنشئت يدوياً ولم تُوضع على المخطط بعد (صينية «الغرف غير الموضوعة»). */
export type UnplacedRoom = { key: string; name: string; type: string; w: number; h: number; notes?: string };

export type FloorGeometry = {
  unit: "m";
  rooms: GeoRoom[];
  /** الغرف المُنشأة يدوياً بانتظار الوضع على المخطط — تُحفظ في المسودة ولا تُنشر */
  unplaced?: UnplacedRoom[];
  /** عناصر سياقية ترسم باهتة ولا تقبل سجلات (مثل مجمع البنات في الموقع الخارجي) */
  contextShapes?: { key: string; name: string; x: number; y: number; w: number; h: number }[];
  note?: string;
};

export function roomArea(room: Pick<GeoRoom, "w" | "h">): number {
  return Math.round(room.w * room.h * 10) / 10;
}

export function roomPerimeter(room: Pick<GeoRoom, "w" | "h">): number {
  return Math.round((room.w + room.h) * 2 * 10) / 10;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * مزامنة تعديل غرفة (اسم/نوع/أبعاد) داخل هندسة الدور — مصدر الحقيقة الواحد.
 * الغرف في هذا النموذج مستطيلات محاذية للمحاور (x,y,w,h)، لذا تغيير الأبعاد
 * يعيد تحجيم المستطيل حول ركن التثبيت (x,y) دون تحريكه، وتقص إزاحات الأبواب
 * لتبقى داخل الحدود الجديدة. يعيد null إذا لم توجد الغرفة بالمفتاح.
 */
export function applyRoomEditToGeometry(
  geometry: FloorGeometry,
  geomKey: string,
  edit: { name: string; type: string; lengthM?: number; widthM?: number },
): FloorGeometry | null {
  const target = geometry.rooms.find((r) => r.key === geomKey);
  if (!target) return null;
  const next: GeoRoom = { ...target, name: edit.name, type: edit.type };
  if (edit.lengthM != null && edit.lengthM > 0) next.w = round1(edit.lengthM);
  if (edit.widthM != null && edit.widthM > 0) next.h = round1(edit.widthM);
  if (next.doors && next.doors.length > 0) {
    next.doors = next.doors.map((d) => ({
      ...d,
      offset: round1(Math.max(0, Math.min(d.offset, d.side === "top" || d.side === "bottom" ? next.w : next.h))),
    }));
  }
  return { ...geometry, rooms: geometry.rooms.map((r) => (r.key === geomKey ? next : r)) };
}

/** تقاطع مستطيلين محاذيين للمحاور مع هامش صغير (تفادي التلامس الحدّي) */
function rectsOverlap(a: GeoRoom, b: GeoRoom): boolean {
  const eps = 0.05;
  return a.x < b.x + b.w - eps && a.x + a.w - eps > b.x && a.y < b.y + b.h - eps && a.y + a.h - eps > b.y;
}

/**
 * تحقق الهندسة: أخطاء صلبة تمنع الحفظ (أبعاد غير موجبة/غير معقولة، مفاتيح، أسماء)،
 * وتنبيهات لا تمنع الحفظ لكن تُعرض للمدير: **تداخل الغرف** و**خروجها عن حدود المخطط**
 * (المخطط تشغيلي وليس رسماً هندسياً معتمداً، فالتداخل/الحدود تنبيه لا منع).
 */
export function validateGeometry(geo: unknown): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const g = geo as FloorGeometry;
  if (!g || g.unit !== "m" || !Array.isArray(g.rooms)) {
    return { ok: false, errors: ["بنية الهندسة غير صحيحة"], warnings };
  }
  const keys = new Set<string>();
  for (const r of g.rooms) {
    if (!r.key || keys.has(r.key)) errors.push(`مفتاح غرفة مكرر أو مفقود: ${r.key ?? "?"}`);
    keys.add(r.key);
    if (!r.name?.trim()) errors.push(`غرفة بلا اسم (${r.key})`);
    if (!(r.w > 0) || !(r.h > 0)) errors.push(`أبعاد غير موجبة للغرفة «${r.name}»`);
    if (r.w > 200 || r.h > 200) errors.push(`أبعاد غير معقولة للغرفة «${r.name}»`);
    // حدود المخطط: إحداثيات سالبة تعني خروج الغرفة عن حدود الأصل
    if (r.x < 0 || r.y < 0) warnings.push(`الغرفة «${r.name}» خارج حدود المخطط (إحداثيات سالبة)`);
  }
  // تداخل الغرف (مستطيلات محاذية للمحاور)
  for (let i = 0; i < g.rooms.length; i++) {
    for (let j = i + 1; j < g.rooms.length; j++) {
      if (rectsOverlap(g.rooms[i], g.rooms[j])) {
        warnings.push(`تداخل بين «${g.rooms[i].name}» و«${g.rooms[j].name}»`);
      }
    }
  }
  // الغرف غير الموضوعة: تحقق الاسم والأبعاد فقط (لا إحداثيات) وضمّ مفاتيحها لكشف التكرار
  if (Array.isArray(g.unplaced)) {
    for (const r of g.unplaced) {
      if (!r.key || keys.has(r.key)) errors.push(`مفتاح غرفة مكرر أو مفقود: ${r.key ?? "?"}`);
      keys.add(r.key);
      if (!r.name?.trim()) errors.push("غرفة غير موضوعة بلا اسم");
      if (!(r.w > 0) || !(r.h > 0)) errors.push(`أبعاد غير موجبة للغرفة «${r.name}»`);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

export const ROOM_TYPES = [
  "فصل دراسي",
  "معمل",
  "مكتب إداري",
  "غرفة معلمين",
  "مصادر تعلم",
  "مستودع",
  "دورة مياه",
  "خدمات",
  "ممر",
  "سلم",
  "مدخل",
  "مخرج طوارئ",
  "ملعب",
  "ساحة",
  "بوابة",
  "مظلة",
  "مرفق سلامة",
  "مرفق مياه",
  "مرفق كهرباء",
  "مرفق شبكة",
  "مرفق خارجي",
  "أخرى",
] as const;

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

export type FloorGeometry = {
  unit: "m";
  rooms: GeoRoom[];
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

export function validateGeometry(geo: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const g = geo as FloorGeometry;
  if (!g || g.unit !== "m" || !Array.isArray(g.rooms)) {
    return { ok: false, errors: ["بنية الهندسة غير صحيحة"] };
  }
  const keys = new Set<string>();
  for (const r of g.rooms) {
    if (!r.key || keys.has(r.key)) errors.push(`مفتاح غرفة مكرر أو مفقود: ${r.key ?? "?"}`);
    keys.add(r.key);
    if (!r.name?.trim()) errors.push(`غرفة بلا اسم (${r.key})`);
    if (!(r.w > 0) || !(r.h > 0)) errors.push(`أبعاد غير موجبة للغرفة «${r.name}»`);
    if (r.w > 200 || r.h > 200) errors.push(`أبعاد غير معقولة للغرفة «${r.name}»`);
  }
  return { ok: errors.length === 0, errors };
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

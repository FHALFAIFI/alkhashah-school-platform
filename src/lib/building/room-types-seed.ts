import "server-only";
import { db } from "@/db";
import { roomTypes } from "@/db/schema";

/**
 * الأنواع النظامية لسجل أنواع الغرف (D-037) — النسخة الحيّة نفسها المجمَّدة في
 * ترحيل 0025. إدراج idempotent (onConflictDoNothing على المفتاح) فلا يكرر ولا
 * يعيد كتابة تعديلات المدير على الأسماء أو الترتيب.
 */
export const SYSTEM_ROOM_TYPES: { key: string; labelAr: string; aliases: string[] }[] = [
  { key: "classroom", labelAr: "فصل دراسي", aliases: [] },
  { key: "computer-lab", labelAr: "مختبر حاسب", aliases: ["معمل حاسب", "مختبر الحاسب"] },
  { key: "science-lab", labelAr: "مختبر علوم", aliases: ["معمل", "مختبر", "معمل علوم"] },
  { key: "library", labelAr: "مكتبة", aliases: ["مصادر تعلم", "مركز مصادر"] },
  { key: "admin-office", labelAr: "مكتب إداري", aliases: [] },
  { key: "teachers-room", labelAr: "غرفة معلمين", aliases: [] },
  { key: "storage", labelAr: "مستودع", aliases: [] },
  { key: "wc", labelAr: "دورة مياه", aliases: ["دورات مياه"] },
  { key: "yard", labelAr: "ساحة", aliases: ["ساحة طابور"] },
  { key: "corridor", labelAr: "ممر", aliases: [] },
  { key: "stairs", labelAr: "درج", aliases: ["سلم"] },
  { key: "prayer-room", labelAr: "مصلى", aliases: [] },
  { key: "electrical-room", labelAr: "غرفة كهرباء", aliases: ["مرفق كهرباء"] },
  { key: "safety-room", labelAr: "غرفة أمن وسلامة", aliases: ["مرفق سلامة"] },
  { key: "multipurpose-hall", labelAr: "قاعة متعددة الأغراض", aliases: [] },
  { key: "playground", labelAr: "ملعب", aliases: [] },
  { key: "entrance", labelAr: "مدخل", aliases: ["بوابة"] },
  { key: "emergency-exit", labelAr: "مخرج طوارئ", aliases: [] },
  { key: "canopy", labelAr: "مظلة", aliases: [] },
  { key: "water-facility", labelAr: "مرفق مياه", aliases: [] },
  { key: "network-facility", labelAr: "مرفق شبكة", aliases: [] },
  { key: "external-facility", labelAr: "مرفق خارجي", aliases: [] },
  { key: "services", labelAr: "خدمات", aliases: [] },
  { key: "other", labelAr: "أخرى", aliases: [] },
];

export async function ensureSystemRoomTypes(): Promise<void> {
  await db
    .insert(roomTypes)
    .values(
      SYSTEM_ROOM_TYPES.map((t, i) => ({
        key: t.key,
        labelAr: t.labelAr,
        aliases: t.aliases,
        sortOrder: i,
        isSystem: true,
      })),
    )
    .onConflictDoNothing({ target: roomTypes.key });
}

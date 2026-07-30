/**
 * حلّ أنواع الغرف (v2.3 §16-17, D-037) — دوال نقية بلا قاعدة بيانات.
 *
 * السجل الموحّد في جدول `room_types` (مفتاح + اسم + أسماء تاريخية aliases).
 * الغرف والقوالب تحمل نصوصاً حرة تاريخية تبقى كما هي حرفياً؛ المطابقة تجري
 * بحلّ النص إلى مفتاح النوع عبر الاسم أو أحد أسمائه التاريخية.
 */

export type RoomTypeEntry = {
  key: string;
  labelAr: string;
  aliases: string[];
  active: boolean;
};

/** حلّ نص نوع (اسم غرفة أو نوع قالب) إلى مفتاح النوع في السجل — أو null إن لم يُعرف */
export function resolveRoomTypeKey(label: string | null | undefined, registry: RoomTypeEntry[]): string | null {
  if (!label) return null;
  const needle = label.trim();
  if (needle.length === 0) return null;
  for (const t of registry) {
    if (t.labelAr === needle || t.key === needle) return t.key;
    if (t.aliases.some((a) => a === needle)) return t.key;
  }
  return null;
}

/**
 * هل ينطبق قالب الفحص على غرفة؟ (مطابقة عبر السجل لا بالنص الحرفي)
 * قالب بلا نوع = قالب عام ينطبق على كل الغرف.
 * نص لا يُحل إلى السجل يعود للمطابقة الحرفية القديمة فلا يفقد أحد قالبه.
 */
export function templateAppliesToRoom(
  templateRoomType: string | null | undefined,
  roomRoomType: string | null | undefined,
  registry: RoomTypeEntry[],
): boolean {
  if (!templateRoomType) return true; // قالب عام
  const templateKey = resolveRoomTypeKey(templateRoomType, registry);
  const roomKey = resolveRoomTypeKey(roomRoomType, registry);
  if (templateKey && roomKey) return templateKey === roomKey;
  // احتياط: المطابقة الحرفية القديمة حين لا يُعرف النص في السجل
  return (templateRoomType ?? "").trim() === (roomRoomType ?? "").trim();
}

/** خيارات العرض لقوائم الاختيار — الأنواع الفعّالة بترتيبها */
export function roomTypeOptions(registry: RoomTypeEntry[]): { value: string; label: string }[] {
  return registry.filter((t) => t.active).map((t) => ({ value: t.labelAr, label: t.labelAr }));
}

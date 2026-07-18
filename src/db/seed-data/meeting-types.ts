/** أنواع الاجتماعات الافتراضية (عربية) — يديرها المدير لاحقاً بالإضافة/التفعيل/التعطيل. */
export const DEFAULT_MEETING_TYPES: { key: string; nameAr: string; sortOrder: number }[] = [
  { key: "periodic", nameAr: "دوري", sortOrder: 1 },
  { key: "emergency", nameAr: "طارئ", sortOrder: 2 },
  { key: "followup", nameAr: "متابعة", sortOrder: 3 },
  { key: "closing", nameAr: "ختامي", sortOrder: 4 },
  { key: "plc", nameAr: "مجتمع تعلم مهني", sortOrder: 5 },
];

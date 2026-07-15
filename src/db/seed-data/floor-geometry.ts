import type { FloorGeometry } from "@/lib/building/geometry";

/**
 * الرسم الأولي للأدوار — منقول يدوياً من «مخطط المبنى.pptx» (الأسماء والأبعاد من مربعات النص،
 * والتخطيط من الصور المعمارية: جناح علوي من الفصول على ممر توزيع، وجناح سفلي للمرافق، وسلمان طرفيان).
 * هذه مسودة تشغيلية تقارن جنباً إلى جنب مع صورة المصدر داخل المحرر ويصححها المدير قبل النشر.
 * الأبعاد المصرح بها في المصدر: فصول 5×7، خدمات 3×3، غرف 5×5، حمام 2×2.
 */

// الجناح العلوي: 5 غرف 7×5 تبدأ بعد سلم 1 (3م) — الممر 3م — الجناح السفلي غرف 7×5
function standardFloor(
  topRooms: { key: string; name: string; type: string }[],
  bottomRooms: { key: string; name: string; type: string; w?: number }[],
  extra: FloorGeometry["rooms"] = [],
): FloorGeometry {
  const rooms: FloorGeometry["rooms"] = [];
  // سلمان في الطرفين
  rooms.push({ key: "stair-1", name: "سلم 1", type: "سلم", x: 0, y: 5, w: 3, h: 3, doors: [{ side: "bottom", offset: 1.5 }] });
  rooms.push({ key: "stair-2", name: "سلم 2", type: "سلم", x: 38, y: 5, w: 3, h: 3, doors: [{ side: "bottom", offset: 1.5 }] });
  // الجناح العلوي: 5 غرف 7×5
  topRooms.forEach((r, i) => {
    rooms.push({ key: r.key, name: r.name, type: r.type, x: 3 + i * 7, y: 0, w: 7, h: 5, doors: [{ side: "bottom", offset: 3.5 }] });
  });
  // ممر التوزيع
  rooms.push({ key: "corridor", name: "ممر توزيع", type: "ممر", x: 0, y: 5, w: 41, h: 3 });
  // الجناح السفلي
  let x = 3;
  bottomRooms.forEach((r) => {
    const w = r.w ?? 7;
    rooms.push({ key: r.key, name: r.name, type: r.type, x, y: 8, w, h: 5, doors: [{ side: "top", offset: w / 2 }] });
    x += w;
  });
  rooms.push(...extra);
  return {
    unit: "m",
    rooms,
    note: "مخطط تشغيلي — ليس رسماً هندسياً معتمداً. قارن مع صورة المصدر وصحح قبل النشر.",
  };
}

export const groundFloorGeometry = standardFloor(
  [
    { key: "store", name: "المستودع", type: "مستودع" },
    { key: "meeting", name: "غرفة الاجتماعات", type: "مكتب إداري" },
    { key: "admin-office", name: "مكتب الاداريين", type: "مكتب إداري" },
    { key: "pe-room", name: "غرفة البدنية", type: "أخرى" },
    { key: "class-5", name: "فصل 5", type: "فصل دراسي" },
  ],
  [
    { key: "wc", name: "دورات مياه", type: "دورة مياه", w: 4 },
    { key: "entrance", name: "المدخل الرئيسي", type: "مدخل", w: 6 },
    { key: "control", name: "غرفة التحكم", type: "مرفق كهرباء", w: 2 },
    { key: "principal", name: "مكتب مدير المدرسة", type: "مكتب إداري", w: 6 },
    { key: "science-lab", name: "معمل العلوم", type: "معمل" },
    { key: "computer-lab", name: "معمل الحاسب", type: "معمل" },
  ],
  [
    { key: "exit-1", name: "مخرج طوارئ غربي", type: "مخرج طوارئ", x: 0, y: 8, w: 1.5, h: 2 },
    { key: "exit-2", name: "مخرج طوارئ شرقي", type: "مخرج طوارئ", x: 39.5, y: 8, w: 1.5, h: 2 },
    { key: "clinic", name: "العيادة الصحية", type: "أخرى", x: 0, y: 10, w: 3, h: 3 },
  ],
);

export const firstFloorGeometry = standardFloor(
  [
    { key: "arabic-hall", name: "قاعة اللغة العربية", type: "فصل دراسي" },
    { key: "c-2s2", name: "2ث2", type: "فصل دراسي" },
    { key: "health-lab", name: "معمل الصحة", type: "معمل" },
    { key: "c-2s1", name: "2ث1", type: "فصل دراسي" },
    { key: "c-3s1", name: "3ث1", type: "فصل دراسي" },
  ],
  [
    { key: "services", name: "خدمات", type: "خدمات", w: 3 },
    { key: "vice-edu", name: "وكيل الشؤون التعليمية", type: "مكتب إداري", w: 5 },
    { key: "c-3s2", name: "3ث2", type: "فصل دراسي" },
    { key: "teachers", name: "غرفة معلمين", type: "غرفة معلمين" },
    { key: "library", name: "المكتبة والمصادر", type: "مصادر تعلم", w: 7 },
    { key: "room-5x5", name: "غرفة 5×5", type: "أخرى", w: 5 },
  ],
);

export const secondFloorGeometry = standardFloor(
  [
    { key: "c-1s1", name: "1ث1", type: "فصل دراسي" },
    { key: "c-1s2", name: "1ث2", type: "فصل دراسي" },
    { key: "c-2m1", name: "2م1", type: "فصل دراسي" },
    { key: "c-1m2", name: "1م2", type: "فصل دراسي" },
    { key: "c-3m", name: "3م", type: "فصل دراسي" },
  ],
  [
    { key: "services", name: "خدمات", type: "خدمات", w: 3 },
    { key: "teachers", name: "غرفة معلمين", type: "غرفة معلمين" },
    { key: "guidance", name: "التوجيه الطلابي", type: "مكتب إداري", w: 5 },
    { key: "activity", name: "النشاط الطلابي", type: "أخرى" },
    { key: "multipurpose", name: "متعددة الأغراض", type: "أخرى" },
  ],
);

export const thirdFloorGeometry = standardFloor(
  [
    { key: "c-4b", name: "4ب", type: "فصل دراسي" },
    { key: "c-5b", name: "5ب", type: "فصل دراسي" },
    { key: "c-6b", name: "6ب", type: "فصل دراسي" },
    { key: "sci-lab-primary", name: "معمل علوم ابتدائي", type: "معمل" },
    { key: "c-1m1", name: "1م1", type: "فصل دراسي" },
  ],
  [
    { key: "services", name: "خدمات", type: "خدمات", w: 3 },
    { key: "teachers", name: "غرفة معلمين", type: "غرفة معلمين" },
    { key: "vice-students", name: "وكيل شؤون الطلاب", type: "مكتب إداري", w: 5 },
    { key: "computer-lab-2", name: "معمل حاسب 2", type: "معمل" },
    { key: "english-lab", name: "معمل الانجليزي", type: "معمل" },
  ],
);

/**
 * الموقع الخارجي — من «أبو فهد_041337.pdf»: المعايرة على ملعب كرة القدم 26م × 18م،
 * والقياسات المدونة: مظلة 9×6 و11×4 و3.5م، غرف خارجية 5×6 و4×4، مدخل 3.5×2.
 * مجمع البنات (الشمالي) سياق جغرافي فقط — يرسم باهتاً ولا يقبل غرفاً أو أصولاً.
 */
export const siteGeometry: FloorGeometry = {
  unit: "m",
  rooms: [
    { key: "building", name: "مبنى مجمع البنين", type: "أخرى", x: 5, y: 2, w: 41, h: 13 },
    { key: "field", name: "ملعب كرة القدم", type: "ملعب", x: 14, y: 24, w: 26, h: 18 },
    { key: "yard", name: "الساحة الداخلية", type: "ساحة", x: 2, y: 15, w: 45, h: 9 },
    { key: "canopy", name: "المظلة", type: "مظلة", x: 42, y: 17, w: 11, h: 6 },
    { key: "ext-room-1", name: "غرفة خارجية شرقية", type: "مرفق خارجي", x: 44, y: 24, w: 9, h: 6 },
    { key: "ext-room-2", name: "غرفة خارجية غربية", type: "مرفق خارجي", x: 2, y: 26, w: 5, h: 6 },
    { key: "ext-room-3", name: "ملحق غربي", type: "مرفق خارجي", x: 2, y: 33, w: 4, h: 4 },
    { key: "gate-main", name: "البوابة الرئيسية", type: "بوابة", x: 0, y: 20, w: 3.5, h: 2 },
    { key: "water", name: "خزان المياه", type: "مرفق مياه", x: 48, y: 2, w: 3, h: 3 },
    { key: "electricity", name: "غرفة الكهرباء", type: "مرفق كهرباء", x: 48, y: 6, w: 3, h: 3 },
  ],
  contextShapes: [
    { key: "girls-complex", name: "مجمع البنات (سياق جغرافي فقط)", x: 5, y: -18, w: 45, h: 16 },
  ],
  note: "معاير على ملعب 26×18م من المخطط الجوي — مخطط تشغيلي وليس رسماً هندسياً معتمداً. حدود مقترحة يصححها المدير.",
};

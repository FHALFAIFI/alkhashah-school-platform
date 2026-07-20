/**
 * Phase 3 — تعريفات قوالب الفحص (أنواع + ثوابت + دوال نقية بلا خادم).
 * وحدة قابلة للاستيراد من العميل والخادم والبذرة معاً (لا تعتمد على قاعدة البيانات).
 *
 * القالب عائلة من الإصدارات: كل صف قالب يحمل code ثابتاً للعائلة و rootId يشير لأول
 * إصدار و version تصاعدي. التحرير على مسودة يجري في مكانه؛ تحرير قالب مُفعّل/مستخدَم
 * ينشئ إصداراً جديداً (مسودة). عند بدء الفحص يُجمَّد snapshot من الإصدار المستخدَم في
 * سجل الفحص فلا تغيّره التعديلات اللاحقة. الإصدارات المستخدَمة لا تُحذف نهائياً (تُعطَّل).
 *
 * الحالة (status) القيمة المخزّنة: مسودة | معتمد (=مُفعّل/قابل للاستخدام) | معطّل.
 * أبقينا «معتمد» كقيمة التفعيل حفاظاً على توافق قرّاء قائمين (المزامنة/الفحص/الجاهزية).
 */

export type TemplateResponseType =
  | "yes_no" // نعم / لا
  | "compliant" // مطابق / غير مطابق
  | "numeric" // قيمة رقمية
  | "rating" // مقياس تقدير
  | "text" // نص حر
  | "date" // تاريخ
  | "photo" // صورة
  | "attachment"; // مرفق

export const RESPONSE_TYPE_LABELS: Record<TemplateResponseType, string> = {
  yes_no: "نعم / لا",
  compliant: "مطابق / غير مطابق",
  numeric: "قيمة رقمية",
  rating: "مقياس تقدير",
  text: "نص حر",
  date: "تاريخ",
  photo: "صورة",
  attachment: "مرفق",
};

export const SEVERITY_LEVELS = ["منخفض", "متوسط", "عالٍ", "حرج"] as const;
export type Severity = (typeof SEVERITY_LEVELS)[number];

export type TemplateItem = {
  key: string;
  label: string;
  instructions?: string;
  required: boolean;
  responseType: TemplateResponseType;
  ratingMax?: number;
  severityOnFail?: Severity;
  correctiveActionRequired?: boolean;
};

export type TemplateSection = {
  key: string;
  title: string;
  instructions?: string;
  items: TemplateItem[];
};

export type TemplateAssignment = {
  buildingKeys?: string[];
  floorKeys?: string[];
  roomTypes?: string[];
  roomIds?: string[];
  assetCategories?: string[];
  purposes?: string[];
};

export const TEMPLATE_STATUS = {
  draft: "مسودة",
  active: "معتمد",
  deactivated: "معطّل",
} as const;

export function statusLabel(status: string): string {
  if (status === TEMPLATE_STATUS.active) return "مُفعّل";
  if (status === TEMPLATE_STATUS.deactivated) return "معطّل";
  return "مسودة";
}

/** تسطيح الأقسام إلى قائمة عناصر مبسطة {key,label,required} — للتوافق مع الفحص/الجاهزية/عدم الاتصال. */
export function flattenItems(sections: TemplateSection[]): { key: string; label: string; required: boolean }[] {
  return sections.flatMap((s) => s.items.map((i) => ({ key: i.key, label: i.label, required: i.required })));
}

/** تحقق بنيوي من الأقسام/العناصر قبل الحفظ. يعيد رسالة خطأ عربية أو null. */
export function validateSections(sections: unknown): string | null {
  if (!Array.isArray(sections) || sections.length === 0) return "أضف قسماً واحداً على الأقل";
  const keys = new Set<string>();
  for (const s of sections as TemplateSection[]) {
    if (!s || typeof s.title !== "string" || s.title.trim().length === 0) return "لكل قسم عنوان إلزامي";
    if (!Array.isArray(s.items) || s.items.length === 0) return `القسم «${s.title}» يحتاج عنصر فحص واحداً على الأقل`;
    for (const it of s.items) {
      if (!it || typeof it.label !== "string" || it.label.trim().length === 0) return "لكل عنصر فحص وصف إلزامي";
      if (!(it.responseType in RESPONSE_TYPE_LABELS)) return `نوع إجابة غير معروف في «${it.label}»`;
      if (typeof it.key !== "string" || !it.key) return "مفتاح العنصر مفقود";
      if (keys.has(it.key)) return `مفتاح مكرر: ${it.key}`;
      keys.add(it.key);
    }
  }
  return null;
}

/** قوالب النظام الافتراضية — ليست نتائج فحص وهمية، بل قوالب مرجعية قابلة للتحرير والتكرار. */
export function systemTemplates(): {
  nameAr: string;
  roomType: string | null;
  purpose: string;
  sections: TemplateSection[];
}[] {
  const yn = (key: string, label: string, sev?: Severity, corrective = false): TemplateItem => ({
    key,
    label,
    required: true,
    responseType: "compliant",
    severityOnFail: sev,
    correctiveActionRequired: corrective,
  });
  return [
    {
      nameAr: "جاهزية الغرفة العامة",
      roomType: null,
      purpose: "الجاهزية",
      sections: [
        {
          key: "s1",
          title: "الحالة العامة",
          items: [
            yn("clean", "الغرفة نظيفة ومرتبة", "منخفض"),
            yn("lighting", "الإضاءة تعمل بالكامل", "متوسط"),
            yn("ac", "التكييف يعمل", "متوسط"),
            { key: "temp", label: "درجة الحرارة المقاسة (°م)", required: false, responseType: "numeric" },
          ],
        },
      ],
    },
    {
      nameAr: "السلامة العامة",
      roomType: null,
      purpose: "السلامة",
      sections: [
        {
          key: "s1",
          title: "مخارج ومسارات",
          items: [
            yn("exit", "مخرج الطوارئ سالك وواضح", "حرج", true),
            yn("signage", "لوحات الإرشاد موجودة", "عالٍ"),
            yn("first_aid", "حقيبة الإسعافات متوفرة وسارية", "عالٍ", true),
          ],
        },
      ],
    },
    {
      nameAr: "النظافة",
      roomType: null,
      purpose: "النظافة",
      sections: [
        {
          key: "s1",
          title: "النظافة العامة",
          items: [
            yn("floor", "الأرضيات نظيفة", "منخفض"),
            yn("waste", "سلال المهملات مفرّغة", "منخفض"),
            yn("windows", "النوافذ نظيفة", "منخفض"),
          ],
        },
      ],
    },
    {
      nameAr: "السلامة الكهربائية",
      roomType: null,
      purpose: "السلامة",
      sections: [
        {
          key: "s1",
          title: "التمديدات الكهربائية",
          items: [
            yn("sockets", "المقابس سليمة وغير مكشوفة", "حرج", true),
            yn("wiring", "لا أسلاك مكشوفة أو تالفة", "حرج", true),
            yn("panel", "لوحة الكهرباء مغلقة وموسومة", "عالٍ"),
          ],
        },
      ],
    },
    {
      nameAr: "المختبر",
      roomType: "مختبر",
      purpose: "السلامة",
      sections: [
        {
          key: "s1",
          title: "سلامة المختبر",
          items: [
            yn("chemicals", "المواد الكيميائية مخزّنة بأمان وموسومة", "حرج", true),
            yn("ventilation", "التهوية/الشفط يعمل", "عالٍ"),
            yn("eyewash", "غسول العين متوفر ويعمل", "عالٍ", true),
            yn("extinguisher", "طفاية الحريق سارية وقريبة", "حرج", true),
          ],
        },
      ],
    },
    {
      nameAr: "مختبر الحاسب",
      roomType: "مختبر حاسب",
      purpose: "الجاهزية",
      sections: [
        {
          key: "s1",
          title: "الأجهزة والشبكة",
          items: [
            { key: "pcs_working", label: "عدد الأجهزة العاملة", required: true, responseType: "numeric" },
            yn("network", "الشبكة تعمل", "متوسط"),
            yn("cables", "الكابلات منظمة وآمنة", "متوسط"),
            yn("power_strip", "موزعات الطاقة سليمة", "عالٍ", true),
          ],
        },
      ],
    },
    {
      nameAr: "معدات الحريق",
      roomType: null,
      purpose: "السلامة",
      sections: [
        {
          key: "s1",
          title: "طفايات وإنذار",
          items: [
            yn("extinguisher_valid", "الطفاية سارية المفعول", "حرج", true),
            yn("extinguisher_access", "الطفاية في مكانها وسهلة الوصول", "عالٍ"),
            yn("alarm", "جهاز الإنذار سليم", "عالٍ"),
            { key: "next_check", label: "تاريخ الفحص القادم", required: false, responseType: "date" },
          ],
        },
      ],
    },
    {
      nameAr: "المصعد",
      roomType: null,
      purpose: "السلامة",
      sections: [
        {
          key: "s1",
          title: "سلامة المصعد",
          items: [
            yn("cert", "شهادة الفحص الدوري سارية", "حرج", true),
            yn("emergency_phone", "هاتف الطوارئ يعمل", "عالٍ"),
            yn("doors", "الأبواب تعمل بسلاسة وأمان", "عالٍ"),
          ],
        },
      ],
    },
    {
      nameAr: "دورات المياه",
      roomType: "دورة مياه",
      purpose: "النظافة",
      sections: [
        {
          key: "s1",
          title: "النظافة والصيانة",
          items: [
            yn("clean", "نظيفة ومعقّمة", "متوسط"),
            yn("water", "المياه متوفرة", "عالٍ"),
            yn("no_leak", "لا تسريبات", "متوسط", true),
            yn("supplies", "مستلزمات النظافة متوفرة", "منخفض"),
          ],
        },
      ],
    },
    {
      nameAr: "المرافق الخارجية",
      roomType: "ساحة",
      purpose: "السلامة",
      sections: [
        {
          key: "s1",
          title: "الساحات والملاعب",
          items: [
            yn("surface", "الأرضية سليمة وغير خطرة", "عالٍ", true),
            yn("shade", "المظلات سليمة", "متوسط"),
            yn("equipment", "المعدات الرياضية آمنة", "عالٍ"),
          ],
        },
      ],
    },
  ];
}

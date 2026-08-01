import { TEMPLATE_DOC_TYPES, type TemplateDocType } from "./schema";

/**
 * البنية القابلة للتحرير في القالب (v2.2 §E2) — **سجل مغلق للأقسام والأعمدة**.
 *
 * لماذا سجل مغلق: المدير يعيد ترتيب الأقسام والأعمدة ويخفيها ويعيد تسميتها، لكنه لا
 * «يخترع» قسماً ولا عموداً. القسم الذي لا يُصيّره المُصيِّر لا وجود له هنا، فلا يظهر في
 * المحرّر خيار بلا أثر، ولا يُقبل مفتاح غير معروف قادم من إعداد مستورد.
 *
 * الأقسام مشتركة بين كل الأنواع لأن هيكل الوثيقة واحد (ترويسة → عنوان → مقدمة → محتوى →
 * خاتمة → ملاحظات → توقيع → تذييل). الأعمدة تختلف بحسب النوع لأن جدول كل وثيقة مختلف.
 *
 * وحدة خالصة — تُختبر وحدوياً وتُستعمل على الخادم والعميل.
 */

export type SectionDef = {
  key: string;
  /** التسمية الافتراضية المعروضة في المحرّر */
  label: string;
  /** هل يقبل هذا القسم عنواناً يكتبه المدير؟ الترويسة والتذييل لا عنوان لهما */
  renamable: boolean;
  /** شرح قصير يظهر في المحرّر — يمنع التخمين */
  hint: string;
};

export type ColumnDef = {
  key: string;
  label: string;
};

/**
 * أقسام الوثيقة بالترتيب الافتراضي. كل قسم هنا يُصيَّر فعلاً في `render.ts` —
 * إخفاؤه يخفيه من المعاينة ومن كل مخرجات القالب.
 */
export const DOC_SECTIONS: readonly SectionDef[] = [
  { key: "header", label: "الترويسة", renamable: false, hint: "الشعار وأسطر الجهة واسم المدرسة" },
  { key: "title", label: "العنوان والعنوان الفرعي", renamable: false, hint: "نصوصه تُحرَّر في مجموعة «النصوص»" },
  { key: "intro", label: "المقدمة", renamable: true, hint: "نص المقدمة" },
  { key: "fixed", label: "النص الثابت", renamable: true, hint: "نص يظهر في كل وثيقة من هذا النوع" },
  { key: "body", label: "المحتوى", renamable: true, hint: "جدول بيانات الوثيقة" },
  { key: "closing", label: "الخاتمة", renamable: true, hint: "نص الخاتمة" },
  { key: "notes", label: "الملاحظات", renamable: true, hint: "الملاحظات أسفل الوثيقة" },
  { key: "signature", label: "التوقيع والاعتماد", renamable: true, hint: "تسميات التوقيع والاعتماد" },
  { key: "footer", label: "التذييل", renamable: false, hint: "نص التذييل ورقم الوثيقة وتاريخ الطباعة" },
] as const;

export const SECTION_KEYS: readonly string[] = DOC_SECTIONS.map((s) => s.key);

export function sectionDef(key: string): SectionDef | undefined {
  return DOC_SECTIONS.find((s) => s.key === key);
}

/**
 * أعمدة جدول كل نوع وثيقة — تطابق البيانات التي تعرضها تلك الوثيقة فعلاً.
 * النوع بلا جدول (خطاب رسمي) قائمته فارغة، فيظهر في المحرّر أنه بلا أعمدة بدل خيارات وهمية.
 */
export const DOC_COLUMNS: Record<TemplateDocType, readonly ColumnDef[]> = {
  program_report: [
    { key: "name", label: "البرنامج" },
    { key: "domain", label: "المجال" },
    { key: "owner", label: "مسؤول التنفيذ" },
    { key: "period", label: "فترة التنفيذ" },
    { key: "executionStatus", label: "حالة التنفيذ" },
    { key: "progress", label: "الإنجاز" },
  ],
  program_closure: [
    { key: "field", label: "البند" },
    { key: "value", label: "القيمة" },
  ],
  financial_report: [
    { key: "item", label: "البند" },
    { key: "allocated", label: "المخصص" },
    { key: "spent", label: "المنفَق" },
    { key: "remaining", label: "المتبقي" },
  ],
  income_expense_report: [
    { key: "date", label: "التاريخ" },
    { key: "kind", label: "النوع" },
    { key: "item", label: "البند" },
    { key: "description", label: "البيان" },
    { key: "amount", label: "المبلغ" },
    { key: "invoiceNumber", label: "رقم الفاتورة" },
  ],
  committee_assignment: [
    { key: "member", label: "العضو" },
    { key: "role", label: "الدور" },
    { key: "task", label: "المهمة" },
    { key: "dueText", label: "الموعد" },
  ],
  committee_minutes: [
    { key: "topic", label: "الموضوع" },
    { key: "outcome", label: "القرار أو التوصية" },
    { key: "owner", label: "المسؤول" },
    { key: "dueText", label: "تاريخ الاستحقاق" },
  ],
  council_minutes: [
    { key: "topic", label: "الموضوع" },
    { key: "outcome", label: "القرار أو التوصية" },
    { key: "owner", label: "المسؤول" },
    { key: "dueText", label: "تاريخ الاستحقاق" },
  ],
  employee_performance_report: [
    { key: "indicator", label: "المؤشر" },
    { key: "weight", label: "الوزن" },
    { key: "rating", label: "التقدير" },
    { key: "score", label: "الدرجة الموزونة" },
  ],
  final_evaluation_report: [
    { key: "indicator", label: "المؤشر" },
    { key: "weight", label: "الوزن" },
    { key: "rating", label: "التقدير" },
    { key: "score", label: "الدرجة الموزونة" },
  ],
  evidence_report: [
    { key: "title", label: "الشاهد" },
    { key: "kind", label: "النوع" },
    { key: "program", label: "البرنامج" },
    { key: "createdAt", label: "تاريخ الرفع" },
  ],
  building_report: [
    { key: "name", label: "المرفق" },
    { key: "location", label: "الموقع" },
    { key: "status", label: "الحالة" },
    { key: "notes", label: "ملاحظات" },
  ],
  risk_report: [
    { key: "code", label: "الرمز" },
    { key: "risk", label: "الخطر" },
    { key: "likelihood", label: "الاحتمال" },
    { key: "impact", label: "الأثر" },
    { key: "treatment", label: "المعالجة" },
    { key: "owner", label: "المسؤول" },
  ],
  external_evaluation_report: [
    { key: "title", label: "الخطة" },
    { key: "goals", label: "الأهداف" },
    { key: "actions", label: "الإجراءات" },
    { key: "status", label: "الحالة" },
  ],
  // ── أنواع v2.3 §9 الجديدة ────────────────────────────────────────────────
  program_card: [
    { key: "field", label: "البند" },
    { key: "value", label: "القيمة" },
  ],
  program_completion: [
    { key: "field", label: "البند" },
    { key: "value", label: "القيمة" },
  ],
  committee_report: [
    { key: "meeting", label: "الاجتماع" },
    { key: "date", label: "التاريخ" },
    { key: "status", label: "الحالة" },
    { key: "outcomes", label: "القرارات" },
  ],
  committee_registry: [
    { key: "committee", label: "اللجنة/المجلس" },
    { key: "member", label: "العضو" },
    { key: "role", label: "الدور" },
    { key: "tasks", label: "المهام المسندة" },
    { key: "taskStatus", label: "حالة المهام" },
  ],
  meeting_minutes: [
    { key: "topic", label: "الموضوع" },
    { key: "outcome", label: "القرار أو التوصية" },
    { key: "owner", label: "المسؤول" },
    { key: "signature", label: "التوقيع" },
  ],
  performance_report: [
    { key: "indicator", label: "المؤشر" },
    { key: "weight", label: "الوزن" },
    { key: "rating", label: "التقدير" },
    { key: "score", label: "الدرجة الموزونة" },
  ],
  overall_performance_report: [
    { key: "criterion", label: "المعيار" },
    { key: "average", label: "المتوسط" },
    { key: "sample", label: "عدد التقييمات" },
    { key: "status", label: "الحالة" },
  ],
  employee_report: [
    { key: "name", label: "الاسم" },
    { key: "category", label: "الفئة" },
    { key: "jobTitle", label: "المسمى" },
    { key: "status", label: "الحالة" },
  ],
  inspection_report: [
    { key: "item", label: "بند الفحص" },
    { key: "result", label: "النتيجة" },
    { key: "severity", label: "الخطورة" },
    { key: "note", label: "الملاحظة" },
  ],
  room_checklist: [
    { key: "item", label: "بند الفحص" },
    { key: "answer", label: "الإجابة" },
    { key: "critical", label: "حرج؟" },
    { key: "note", label: "الملاحظة" },
  ],
  readiness_report: [
    { key: "room", label: "الغرفة" },
    { key: "status", label: "الحالة" },
    { key: "percent", label: "نسبة البنود السليمة" },
    { key: "reason", label: "السبب" },
  ],
  maintenance_letter: [
    { key: "field", label: "البند" },
    { key: "value", label: "القيمة" },
  ],
  maintenance_followup: [
    { key: "date", label: "التاريخ" },
    { key: "status", label: "الحالة" },
    { key: "action", label: "الإجراء" },
    { key: "actor", label: "بواسطة" },
  ],
  maintenance_closure: [
    { key: "field", label: "البند" },
    { key: "value", label: "القيمة" },
  ],
  swot_report: [
    { key: "category", label: "الفئة" },
    { key: "code", label: "الرمز" },
    { key: "text", label: "النص" },
  ],
  executive_report: [
    { key: "section", label: "القسم" },
    { key: "metric", label: "المؤشر" },
    { key: "value", label: "القيمة" },
  ],
  official_letter: [],
};

export function columnsFor(docType: TemplateDocType): readonly ColumnDef[] {
  return DOC_COLUMNS[docType] ?? [];
}

export function columnDef(docType: TemplateDocType, key: string): ColumnDef | undefined {
  return columnsFor(docType).find((c) => c.key === key);
}

/**
 * التحقق من أن كل مفاتيح الأقسام والأعمدة في الإعداد معروفة لهذا النوع (§E2/§E6).
 *
 * يُستدعى حيث يكون النوع معروفاً (إجراءات الخادم) لا داخل مخطط Zod العام، لأن المخطط
 * وحده لا يعرف نوع الوثيقة. المفتاح المجهول يُرفض برسالة عربية تسمّيه — لا يُتجاهل صامتاً.
 */
export function validateStructureKeys(
  config: { columns?: { key: string }[]; sections?: { key: string }[] },
  docType: TemplateDocType,
): { ok: true } | { ok: false; error: string } {
  const allowedSections = new Set(SECTION_KEYS);
  const seenSections = new Set<string>();
  for (const s of config.sections ?? []) {
    if (!allowedSections.has(s.key)) {
      return { ok: false, error: `قسم غير معروف: «${s.key}» — اختر من الأقسام المتاحة` };
    }
    if (seenSections.has(s.key)) return { ok: false, error: `القسم «${s.key}» مكرَّر` };
    seenSections.add(s.key);
  }

  const allowedColumns = new Set(columnsFor(docType).map((c) => c.key));
  const seenColumns = new Set<string>();
  for (const c of config.columns ?? []) {
    if (!allowedColumns.has(c.key)) {
      return { ok: false, error: `عمود غير معروف لهذا النوع: «${c.key}» — اختر من الأعمدة المتاحة` };
    }
    if (seenColumns.has(c.key)) return { ok: false, error: `العمود «${c.key}» مكرَّر` };
    seenColumns.add(c.key);
  }
  return { ok: true };
}

/**
 * دمج إعداد الأقسام مع السجل المغلق — يعيد الترتيب النهائي مع الظهور والتسمية.
 *
 * القسم غير المذكور في الإعداد يبقى ظاهراً بترتيبه الافتراضي: القالب القديم الذي لا
 * يعرف الأقسام لا يفقد شيئاً من وثيقته.
 */
export function resolveSections(
  configured: { key: string; label?: string; visible?: boolean; order?: number }[] | undefined,
): { key: string; label: string | null; visible: boolean; def: SectionDef }[] {
  const byKey = new Map((configured ?? []).map((s) => [s.key, s]));
  return DOC_SECTIONS.map((def, defaultOrder) => {
    const c = byKey.get(def.key);
    return {
      key: def.key,
      // التسمية الفارغة تعني «بلا عنوان» لا «العنوان الافتراضي» — المدير يستطيع إزالة العنوان
      label: c && c.label !== undefined ? (c.label.trim() === "" ? null : c.label) : null,
      visible: c?.visible ?? true,
      def,
      _order: c?.order ?? defaultOrder,
    };
  })
    .sort((a, b) => a._order - b._order || SECTION_KEYS.indexOf(a.key) - SECTION_KEYS.indexOf(b.key))
    .map(({ _order, ...rest }) => rest);
}

/**
 * دمج إعداد الأعمدة مع أعمدة النوع — الترتيب والظهور والتسمية والعرض.
 * العمود غير المذكور يبقى ظاهراً بتسميته الافتراضية.
 */
export function resolveColumns(
  docType: TemplateDocType,
  configured: { key: string; label?: string; visible?: boolean; width?: number; order?: number }[] | undefined,
): { key: string; label: string; visible: boolean; width: number | null }[] {
  const defs = columnsFor(docType);
  const byKey = new Map((configured ?? []).map((c) => [c.key, c]));
  return defs
    .map((def, defaultOrder) => {
      const c = byKey.get(def.key);
      return {
        key: def.key,
        label: c?.label && c.label.trim() !== "" ? c.label : def.label,
        visible: c?.visible ?? true,
        width: c?.width ?? null,
        _order: c?.order ?? defaultOrder,
      };
    })
    .sort((a, b) => a._order - b._order || defs.findIndex((d) => d.key === a.key) - defs.findIndex((d) => d.key === b.key))
    .map(({ _order, ...rest }) => rest);
}

/** كل الأنواع — يُستعمل في اختبارات اكتمال السجل */
export function allDocTypesHaveColumnDefinitions(): boolean {
  return TEMPLATE_DOC_TYPES.every((t) => Array.isArray(DOC_COLUMNS[t]));
}

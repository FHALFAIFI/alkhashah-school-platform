import { escapeHtml } from "@/lib/html-escape";
import { TEMPLATE_DOC_TYPES, type TemplateDocType } from "./schema";

/**
 * نظام العناصر النائبة (v2.2 §E3) — سجل مغلق لا لغة قوالب.
 *
 * الاستبدال نصّي بحت: يُبحث عن `{{key}}` من قائمة معروفة ويُستبدل بقيمة **مهرَّبة**.
 * لا تُقيَّم أي تعبيرات، ولا توجد دوال ولا شروط ولا حلقات ولا وصول إلى كائنات، فلا يوجد
 * سطح لحقن قوالب الخادم (SSTI) أصلاً.
 *
 * العنصر النائب غير المعروف يُرفض عند الحفظ ولا يُصيَّر.
 */

export type PlaceholderDef = {
  key: string;
  label: string;
  /** أنواع الوثائق التي يتوفّر فيها — `null` يعني كل الأنواع */
  docTypes: TemplateDocType[] | null;
};

/** السجل المغلق للعناصر النائبة المتاحة */
export const PLACEHOLDERS: readonly PlaceholderDef[] = [
  // عامة — متاحة في كل الأنواع
  { key: "school_name", label: "اسم المدرسة", docTypes: null },
  { key: "ministry_name", label: "اسم الوزارة", docTypes: null },
  { key: "education_department", label: "إدارة التعليم", docTypes: null },
  { key: "education_office", label: "مكتب التعليم", docTypes: null },
  { key: "principal_name", label: "اسم المدير", docTypes: null },
  { key: "academic_year", label: "العام الدراسي", docTypes: null },
  { key: "document_number", label: "رقم الوثيقة", docTypes: null },
  { key: "verification_code", label: "رمز التحقق", docTypes: null },
  { key: "issue_date", label: "تاريخ الإصدار", docTypes: null },
  { key: "print_date", label: "تاريخ الطباعة", docTypes: null },

  // البرامج
  { key: "program_name", label: "اسم البرنامج", docTypes: ["program_report", "program_closure"] },
  { key: "program_domain", label: "مجال البرنامج", docTypes: ["program_report", "program_closure"] },
  { key: "program_owner", label: "مسؤول البرنامج", docTypes: ["program_report", "program_closure"] },
  { key: "program_progress", label: "نسبة إنجاز البرنامج", docTypes: ["program_report", "program_closure"] },
  { key: "closure_date", label: "تاريخ الإقفال", docTypes: ["program_closure"] },
  { key: "closure_note", label: "ملاحظة الإقفال", docTypes: ["program_closure"] },

  // اللجان والمجالس
  { key: "committee_name", label: "اسم اللجنة", docTypes: ["committee_assignment", "committee_minutes", "council_minutes"] },
  { key: "meeting_date", label: "تاريخ الاجتماع", docTypes: ["committee_minutes", "council_minutes"] },
  { key: "meeting_title", label: "عنوان الاجتماع", docTypes: ["committee_minutes", "council_minutes"] },
  { key: "member_list", label: "قائمة الأعضاء", docTypes: ["committee_assignment", "committee_minutes", "council_minutes"] },
  { key: "task_list", label: "قائمة المهام", docTypes: ["committee_assignment"] },
  { key: "recommendations", label: "التوصيات", docTypes: ["committee_minutes", "council_minutes"] },

  // الأداء
  { key: "employee_name", label: "اسم الموظف", docTypes: ["employee_performance_report", "final_evaluation_report"] },
  { key: "evaluation_period", label: "فترة التقييم", docTypes: ["employee_performance_report", "final_evaluation_report"] },

  // المالية
  { key: "financial_total", label: "الإجمالي المالي", docTypes: ["financial_report", "income_expense_report"] },
  { key: "total_income", label: "إجمالي الإيرادات", docTypes: ["financial_report", "income_expense_report"] },
  { key: "total_expenses", label: "إجمالي المصروفات", docTypes: ["financial_report", "income_expense_report"] },
  { key: "cash_balance", label: "الرصيد الحالي", docTypes: ["financial_report", "income_expense_report"] },
] as const;

/** العناصر النائبة المتاحة لنوع وثيقة معيّن — تُعرض للمدير في المحرّر */
export function placeholdersFor(docType: TemplateDocType): PlaceholderDef[] {
  return PLACEHOLDERS.filter((p) => p.docTypes === null || p.docTypes.includes(docType));
}

/** نمط العنصر النائب: `{{key}}` بمفتاح من حروف لاتينية صغيرة وأرقام وشرطة سفلية فقط */
const PLACEHOLDER_PATTERN = /\{\{\s*([a-z0-9_]+)\s*\}\}/g;

/**
 * استخراج كل العناصر النائبة المذكورة في نص.
 * يُستعمل للتحقق قبل الحفظ ولعرض ما يستعمله القالب.
 */
export function extractPlaceholders(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER_PATTERN)) found.add(m[1]);
  return [...found];
}

/**
 * التحقق من أن كل العناصر النائبة في النص معروفة ومتاحة لهذا النوع (§E3).
 * العنصر المجهول يُرفض برسالة عربية تسمّيه.
 */
export function validatePlaceholders(
  text: string,
  docType: TemplateDocType,
): { ok: true } | { ok: false; error: string } {
  const allowed = new Set(placeholdersFor(docType).map((p) => p.key));
  for (const key of extractPlaceholders(text)) {
    if (!allowed.has(key)) {
      return { ok: false, error: `عنصر نائب غير معروف: {{${key}}} — اختر من القائمة المتاحة لهذا النوع` };
    }
  }
  return { ok: true };
}

/**
 * استبدال العناصر النائبة بقيمها **مهرَّبةً**.
 *
 * الترتيب مقصود: يُهرَّب النص القالبي أولاً ثم تُستبدل العناصر النائبة بقيم مهرَّبة. هكذا
 * لا يستطيع لا نص القالب ولا قيمة البيانات إدخال وسم حي — والقيمة المستبدَلة لا تُعاد
 * قراءتها بحثاً عن عناصر نائبة (فلا استبدال متسلسل ولا حلقة لا نهائية).
 *
 * العنصر النائب بلا قيمة يُصيَّر «—» لا نصاً فارغاً مربكاً ولا اسمه الخام.
 */
export function renderPlaceholders(text: string, values: Record<string, string | number | null | undefined>): string {
  const escapedTemplate = escapeHtml(text);
  const known = new Set(PLACEHOLDERS.map((p) => p.key));
  // بعد التهريب صار `{{` كما هو (ليست من محارف HTML الخاصة) فيبقى النمط صالحاً
  return escapedTemplate.replace(PLACEHOLDER_PATTERN, (full, key: string) => {
    // مفتاح خارج السجل المغلق لا يُستبدل إطلاقاً — يبقى نصاً كما كتبه المستخدم.
    // هذا يمنع الوصول إلى خصائص السلسلة الأولية للكائن (`__proto__`, `constructor`,
    // `toString`)، فلا يتسرّب كائن داخلي إلى وثيقة رسمية.
    if (!known.has(key)) return full;
    // `hasOwn` حارس ثانٍ: لا نقرأ إلا خاصية مملوكة فعلاً لكائن القيم.
    if (!Object.hasOwn(values, key)) return "—";
    const raw = values[key];
    if (raw === null || raw === undefined || String(raw).trim() === "") return "—";
    return escapeHtml(raw);
  });
}

/** كل مفاتيح العناصر النائبة المعروفة — يُستعمل في اختبارات التكامل */
export function allPlaceholderKeys(): string[] {
  return PLACEHOLDERS.map((p) => p.key);
}

/** هل النوع المُمرَّر نوع وثيقة معروف؟ حارس عند حدود الإدخال */
export function isTemplateDocType(value: unknown): value is TemplateDocType {
  return typeof value === "string" && (TEMPLATE_DOC_TYPES as readonly string[]).includes(value);
}

/**
 * تعديل البرنامج في كل حالات دورة الحياة (v2.4.1 §1.6).
 *
 * ── القرار ──────────────────────────────────────────────────────────────────
 * حالة البرنامج **لا تمنع التعديل**. قبل هذا الإصدار كان التعديل بعد الاعتماد يمر عبر
 * «طلب تغيير» يُعتمد لاحقاً، والبرنامج المكتمل أو المغلق لا يُعدَّل أصلاً. المدير هو
 * صاحب البيانات، والمنع كان يدفعه إلى إعادة فتح البرنامج أو إقفاله لتصحيح خطأ إملائي —
 * وهو تشويه للسجل أخطر من التعديل نفسه.
 *
 * ما يبقى صارماً بدلاً من المنع:
 *   • **الصلاحية** — `plan.write` كما هي، لم تُخفَّف.
 *   • **السبب الإلزامي** بعد الاعتماد أو الاكتمال أو الإقفال.
 *   • **سجل تغييرات على مستوى الحقل** (`program_edit_history`): من، ومتى، وفي أي حالة،
 *     وما القيمة السابقة والجديدة، ولماذا.
 *   • **لا تغيير ضمني للحالة**: التعديل لا يعتمد ولا يُلغي اعتماداً ولا يُكمل ولا يفتح
 *     مقفلاً. محاور الاعتماد ودورة الحياة والأرشفة لها إجراءاتها وحدها.
 *   • **حماية التعديل المتزامن** برمز حداثة السجل.
 *
 * وحدة خالصة: بلا قاعدة بيانات وبلا React، فتُختبر وحدوياً بالكامل.
 */

import { PROGRAM_LIFECYCLE, type ProgramLifecycle } from "./lifecycle";

/** الحقول القابلة للتعديل ومسمياتها العربية — مصدر واحد للنموذج والسجل والتحقق */
export const EDITABLE_PROGRAM_FIELDS = {
  name: "اسم البرنامج",
  domain: "المجال",
  generalGoal: "الهدف العام",
  specificGoal: "الهدف الخاص",
  rationale: "مبررات التنفيذ",
  targetGroup: "الفئة المستهدفة",
  mechanism: "آلية التنفيذ",
  periodText: "فترة التنفيذ",
  ownerPosition: "مسؤول التنفيذ",
  participants: "المشاركون",
  kpiText: "مؤشر النجاح",
  targetText: "المستهدف",
  baselineText: "خط الأساس",
  indicatorText: "المؤشر",
  deliverableText: "المخرج المطلوب",
  evidenceText: "الشواهد المطلوبة",
  followupText: "متابعة التنفيذ",
  externalRelation: "العلاقة بجهة خارجية",
  expectedImpact: "الأثر المتوقع",
  priority: "الأولوية",
  budget: "الميزانية",
  hijriStart: "تاريخ البدء (هجري)",
  hijriEnd: "تاريخ الانتهاء (هجري)",
  pausePeriods: "فترات التوقف",
  targetExplanation: "تفسير المستهدف",
  principalNotes: "ملاحظات المدير",
} as const;

export type EditableProgramField = keyof typeof EDITABLE_PROGRAM_FIELDS;

export const EDITABLE_FIELD_KEYS = Object.keys(EDITABLE_PROGRAM_FIELDS) as EditableProgramField[];

export function isEditableProgramField(key: string): key is EditableProgramField {
  return Object.prototype.hasOwnProperty.call(EDITABLE_PROGRAM_FIELDS, key);
}

/** الحقول الرقمية — تُطبَّع قبل المقارنة فلا يُسجَّل «100» ← «100.00» تغييراً */
export const NUMERIC_PROGRAM_FIELDS: readonly EditableProgramField[] = ["budget"];

/** الحقول السردية الطويلة — تُعرض في مربع نص متعدد الأسطر */
export const MULTILINE_PROGRAM_FIELDS: ReadonlySet<EditableProgramField> = new Set([
  "generalGoal",
  "specificGoal",
  "rationale",
  "mechanism",
  "participants",
  "kpiText",
  "deliverableText",
  "evidenceText",
  "followupText",
  "expectedImpact",
  "targetExplanation",
  "principalNotes",
  "pausePeriods",
]);

/* ── التحذيرات ────────────────────────────────────────────────────────────── */

/** نصوص التحذير كما أقرّها المدير حرفياً — تحذير لا مانع */
export const EDIT_WARNINGS = {
  approved: "هذا البرنامج معتمد. سيتم تسجيل التعديلات في سجل البرنامج وقد تؤثر في بيانات التنفيذ والتقارير.",
  completed: "هذا البرنامج مكتمل. سيتم تسجيل التعديلات مع الاحتفاظ بالقيم السابقة.",
  closed: "هذا البرنامج مقفل. سيتم السماح بالتعديل مع الاحتفاظ بسجل كامل للتغييرات.",
} as const;

/** علامة معلوماتية تظهر على البرنامج المعدَّل بعد اعتماده — لا تمنع شيئاً */
export const EDITED_AFTER_APPROVAL_MARKER = "تم تعديل البرنامج بعد الاعتماد";

/** مسمى سجل التغييرات المعروض */
export const EDIT_HISTORY_LABEL = "سجل التغييرات";

export type ProgramEditState = {
  /** حالة الاعتماد: مسودة | معتمد | مقفل (إقفال السنة) */
  approvalStatus: string;
  lifecycle: ProgramLifecycle;
};

/**
 * التحذيرات المعروضة قبل التعديل — قد تجتمع (برنامج معتمد ومكتمل معاً).
 * الترتيب من الأعمّ إلى الأخصّ حتى تُقرأ الرسالة الأقوى أخيراً.
 */
export function editWarningsFor(state: ProgramEditState): string[] {
  const out: string[] = [];
  if (state.approvalStatus === "معتمد" || state.approvalStatus === "مقفل") out.push(EDIT_WARNINGS.approved);
  if (state.lifecycle === PROGRAM_LIFECYCLE.completed) out.push(EDIT_WARNINGS.completed);
  if (state.lifecycle === PROGRAM_LIFECYCLE.closed) out.push(EDIT_WARNINGS.closed);
  return out;
}

/**
 * هل يلزم سبب مكتوب لهذا التعديل؟
 * نعم لكل ما تجاوز المسودة: معتمد أو مكتمل أو مغلق. لا للمسودة وبانتظار الاعتماد.
 */
export function reasonRequiredFor(state: ProgramEditState): boolean {
  return (
    state.approvalStatus === "معتمد" ||
    state.approvalStatus === "مقفل" ||
    state.lifecycle !== PROGRAM_LIFECYCLE.active
  );
}

/** رسالة السبب الناقص — موحّدة بين الخادم والواجهة */
export const REASON_REQUIRED_MESSAGE = "اذكر سبب التعديل — إلزامي للبرنامج المعتمد أو المكتمل أو المقفل";

/* ── كشف التغييرات ────────────────────────────────────────────────────────── */

export type FieldChange = {
  field: EditableProgramField;
  fieldLabel: string;
  oldValue: string | null;
  newValue: string | null;
};

/** نص مطبَّع للمقارنة: الفراغات المحيطة تُزال، والقيمة الفارغة تساوي `null` */
export function normalizeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length === 0 ? null : s;
}

/** تطبيع رقمي: «100.00» و«100» و« 100 » قيمة واحدة، فلا يُسجَّل تغيير وهمي */
function normalizeNumeric(value: unknown): string | null {
  const s = normalizeValue(value);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : s;
}

function normalizeFor(field: EditableProgramField, value: unknown): string | null {
  return NUMERIC_PROGRAM_FIELDS.includes(field) ? normalizeNumeric(value) : normalizeValue(value);
}

/**
 * الحقول التي تغيّرت فعلاً بين السجل الحالي والقيم المُرسلة.
 *
 * الحقل غير المُرسل أصلاً **لا يُعدّ تغييراً إلى الفراغ**: نموذج جزئي أو حقل معطّل في
 * المتصفح كان سيمسح بيانات رسمية بصمت. يُقارَن ما وصل فقط.
 */
export function detectChanges(
  current: Record<string, unknown>,
  submitted: Record<string, unknown>,
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of EDITABLE_FIELD_KEYS) {
    if (!(field in submitted)) continue;
    const oldValue = normalizeFor(field, current[field]);
    const newValue = normalizeFor(field, submitted[field]);
    if (oldValue === newValue) continue;
    changes.push({ field, fieldLabel: EDITABLE_PROGRAM_FIELDS[field], oldValue, newValue });
  }
  return changes;
}

/** ملخص عربي مختصر للتغييرات — يُكتب في سجل التدقيق */
export function changesSummaryAr(changes: FieldChange[]): string {
  return changes.map((c) => c.fieldLabel).join("، ");
}

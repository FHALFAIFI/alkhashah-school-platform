import { describe, it, expect } from "vitest";
import {
  EDITABLE_FIELD_KEYS,
  EDITABLE_PROGRAM_FIELDS,
  EDIT_WARNINGS,
  EDITED_AFTER_APPROVAL_MARKER,
  EDIT_HISTORY_LABEL,
  MULTILINE_PROGRAM_FIELDS,
  REASON_REQUIRED_MESSAGE,
  changesSummaryAr,
  detectChanges,
  editWarningsFor,
  isEditableProgramField,
  normalizeValue,
  reasonRequiredFor,
} from "@/lib/plan/program-edit";
import { PROGRAM_LIFECYCLE } from "@/lib/plan/lifecycle";

/**
 * v2.4.1 §1.6 / §5.7 — تعديل البرنامج في كل حالات دورة الحياة.
 *
 * القاعدة المحمية هنا: الحالة **تحذّر ولا تمنع**، والسبب إلزامي بعد الاعتماد أو الاكتمال
 * أو الإقفال، والتغيير يُلتقط على مستوى الحقل بقيمته السابقة والجديدة، ولا يُخترع تغيير
 * من فرق تنسيقي ولا يُمسح حقل لم يُرسل أصلاً.
 */

const DRAFT = { approvalStatus: "مسودة", lifecycle: PROGRAM_LIFECYCLE.active };
const APPROVED = { approvalStatus: "معتمد", lifecycle: PROGRAM_LIFECYCLE.active };
const COMPLETED = { approvalStatus: "معتمد", lifecycle: PROGRAM_LIFECYCLE.completed };
const CLOSED = { approvalStatus: "معتمد", lifecycle: PROGRAM_LIFECYCLE.closed };
const YEAR_CLOSED = { approvalStatus: "مقفل", lifecycle: PROGRAM_LIFECYCLE.active };

describe("§1.6 — التحذيرات تظهر ولا تمنع", () => {
  it("المسودة بلا تحذير وبلا سبب إلزامي", () => {
    expect(editWarningsFor(DRAFT)).toEqual([]);
    expect(reasonRequiredFor(DRAFT)).toBe(false);
  });

  it("البرنامج المعتمد يحمل نص التحذير المقرَّر حرفياً", () => {
    expect(editWarningsFor(APPROVED)).toEqual([EDIT_WARNINGS.approved]);
    expect(EDIT_WARNINGS.approved).toBe(
      "هذا البرنامج معتمد. سيتم تسجيل التعديلات في سجل البرنامج وقد تؤثر في بيانات التنفيذ والتقارير.",
    );
  });

  it("البرنامج المكتمل يحمل تحذيره ونص الاعتماد معاً — الأخص أخيراً", () => {
    const w = editWarningsFor(COMPLETED);
    expect(w).toEqual([EDIT_WARNINGS.approved, EDIT_WARNINGS.completed]);
    expect(EDIT_WARNINGS.completed).toBe("هذا البرنامج مكتمل. سيتم تسجيل التعديلات مع الاحتفاظ بالقيم السابقة.");
  });

  it("البرنامج المقفل يحمل نص الإقفال المقرَّر", () => {
    expect(editWarningsFor(CLOSED)).toContain(EDIT_WARNINGS.closed);
    expect(EDIT_WARNINGS.closed).toBe(
      "هذا البرنامج مقفل. سيتم السماح بالتعديل مع الاحتفاظ بسجل كامل للتغييرات.",
    );
  });

  it("السبب إلزامي في كل حالة تجاوزت المسودة", () => {
    for (const state of [APPROVED, COMPLETED, CLOSED, YEAR_CLOSED]) {
      expect(reasonRequiredFor(state)).toBe(true);
    }
    expect(REASON_REQUIRED_MESSAGE.length).toBeGreaterThan(0);
  });
});

describe("§1.6 — كشف التغييرات على مستوى الحقل", () => {
  const program = {
    name: "برنامج القراءة",
    domain: "التعليم",
    budget: "1000.00",
    principalNotes: null,
    generalGoal: "  رفع مستوى القراءة  ",
  };

  it("يلتقط الحقل المتغيّر بقيمته السابقة والجديدة ومسماه العربي", () => {
    const changes = detectChanges(program, { name: "برنامج القراءة الموسّع" });
    expect(changes).toEqual([
      {
        field: "name",
        fieldLabel: EDITABLE_PROGRAM_FIELDS.name,
        oldValue: "برنامج القراءة",
        newValue: "برنامج القراءة الموسّع",
      },
    ]);
  });

  it("لا يسجّل تغييراً لفرق تنسيقي رقمي: «1000.00» و«1000» قيمة واحدة", () => {
    expect(detectChanges(program, { budget: "1000" })).toEqual([]);
    expect(detectChanges(program, { budget: " 1000.0 " })).toEqual([]);
  });

  it("لا يسجّل تغييراً لفراغ محيط في نص", () => {
    expect(detectChanges(program, { generalGoal: "رفع مستوى القراءة" })).toEqual([]);
  });

  it("الحقل غير المُرسل لا يُعدّ مسحاً — نموذج جزئي لا يمحو بيانات رسمية", () => {
    // `domain` غائب تماماً عن الإرسال: لا يُسجَّل له تغيير ولا يُمسح
    const changes = detectChanges(program, { name: "اسم جديد" });
    expect(changes.map((c) => c.field)).toEqual(["name"]);
  });

  it("الحقل المُرسل فارغاً يُعدّ مسحاً صريحاً إلى null", () => {
    const changes = detectChanges(program, { domain: "" });
    expect(changes).toEqual([
      { field: "domain", fieldLabel: EDITABLE_PROGRAM_FIELDS.domain, oldValue: "التعليم", newValue: null },
    ]);
  });

  it("الحقل الفارغ أصلاً الذي يُملأ يُسجَّل من null إلى القيمة", () => {
    const changes = detectChanges(program, { principalNotes: "ملاحظة" });
    expect(changes[0]).toMatchObject({ oldValue: null, newValue: "ملاحظة" });
  });

  it("عدة حقول تتغيّر معاً وتُلخَّص عربياً بمسمياتها", () => {
    const changes = detectChanges(program, { name: "جديد", domain: "الشراكة" });
    expect(changes).toHaveLength(2);
    expect(changesSummaryAr(changes)).toBe("اسم البرنامج، المجال");
  });
});

describe("§1.6 — سجل الحقول وثوابته", () => {
  it("كل مفتاح قابل للتعديل له مسمى عربي غير فارغ", () => {
    for (const key of EDITABLE_FIELD_KEYS) {
      expect(EDITABLE_PROGRAM_FIELDS[key].length).toBeGreaterThan(0);
      expect(isEditableProgramField(key)).toBe(true);
    }
  });

  it("لا يقبل مفتاحاً خارج القائمة — حارس ضد الإسناد الجماعي", () => {
    for (const forbidden of ["status", "approvedAt", "closedAt", "completedAt", "archivedAt", "id", "planYearId"]) {
      expect(isEditableProgramField(forbidden)).toBe(false);
    }
    // ولا تلتقطها `detectChanges` حتى لو أُرسلت
    expect(detectChanges({ status: "مسودة" }, { status: "معتمد" })).toEqual([]);
  });

  it("الحقول متعددة الأسطر مجموعة فرعية من الحقول القابلة للتعديل", () => {
    for (const key of MULTILINE_PROGRAM_FIELDS) {
      expect(EDITABLE_FIELD_KEYS).toContain(key);
    }
  });

  it("نصوص العلامة والسجل ثابتة كما يقرؤها المدير", () => {
    expect(EDITED_AFTER_APPROVAL_MARKER).toBe("تم تعديل البرنامج بعد الاعتماد");
    expect(EDIT_HISTORY_LABEL).toBe("سجل التغييرات");
  });

  it("التطبيع يفرّق الفراغ عن القيمة ولا ينتج سلسلة فارغة", () => {
    expect(normalizeValue(null)).toBeNull();
    expect(normalizeValue(undefined)).toBeNull();
    expect(normalizeValue("   ")).toBeNull();
    expect(normalizeValue(" قيمة ")).toBe("قيمة");
    expect(normalizeValue(0)).toBe("0");
  });
});

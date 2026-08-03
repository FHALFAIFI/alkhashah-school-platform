import { describe, it, expect } from "vitest";
import {
  checkProgramConsistency,
  isProgramInconsistent,
  matchesConsistencyFilter,
  type ProgramConsistencyInput,
} from "@/lib/plan/consistency";

/**
 * v2.4.1 §5 — كاشف تناقض حالات البرامج.
 *
 * الحالات المرجعية مأخوذة من **صور سجلات الإنتاج الفعلية** وقت التشخيص (2026-08-03):
 * خمسة برامج معتمدة، أربعة منها «مكتمل» وثلاثة من هذه الأربعة بتقدم 0٪.
 */

const prog = (over: Partial<ProgramConsistencyInput> = {}): ProgramConsistencyInput => ({
  executionStatus: "لم يبدأ",
  progress: 0,
  completedAt: null,
  status: "معتمد",
  ...over,
});

describe("قواعد الكشف", () => {
  it("A — «مكتمل» بتقدم أقل من 100٪", () => {
    const f = checkProgramConsistency(prog({ executionStatus: "مكتمل", progress: 0 }));
    expect(f.map((x) => x.rule)).toContain("A");
  });

  it("B — «مكتمل» بلا تاريخ اكتمال", () => {
    const f = checkProgramConsistency(prog({ executionStatus: "مكتمل", progress: 100, completedAt: null }));
    expect(f.map((x) => x.rule)).toEqual(["B"]);
  });

  it("C — تقدم 100٪ وحالة تنفيذ غير مكتملة", () => {
    const f = checkProgramConsistency(prog({ executionStatus: "قيد التنفيذ", progress: 100 }));
    expect(f.map((x) => x.rule)).toContain("C");
  });

  it("D — مقفل بينما التنفيذ غير مكتمل موثقاً", () => {
    const f = checkProgramConsistency(prog({ status: "مقفل", executionStatus: "قيد التنفيذ", progress: 50 }));
    expect(f.map((x) => x.rule)).toContain("D");
  });

  it("E — تاريخ اكتمال مسجَّل وحالة التنفيذ لا توافقه", () => {
    const f = checkProgramConsistency(
      prog({ executionStatus: "متأخر", progress: 40, completedAt: new Date("2026-07-30") }),
    );
    expect(f.map((x) => x.rule)).toContain("E");
  });

  it("السجل المتسق تماماً لا يُبلَّغ عنه", () => {
    const f = checkProgramConsistency(
      prog({ executionStatus: "مكتمل", progress: 100, completedAt: new Date("2026-07-30") }),
    );
    expect(f).toEqual([]);
    expect(isProgramInconsistent(prog({ executionStatus: "لم يبدأ", progress: 0 }))).toBe(false);
  });

  it("قد تجتمع عدة قواعد على سجل واحد", () => {
    // seq 1 و29 في الإنتاج: «مكتمل» + 0٪ + بلا تاريخ اكتمال → A و B معاً
    const f = checkProgramConsistency(prog({ executionStatus: "مكتمل", progress: 0, completedAt: null }));
    expect(f.map((x) => x.rule).sort()).toEqual(["A", "B"]);
  });
});

describe("لقطة الإنتاج 2026-08-03 — البرامج المعتمدة الخمسة", () => {
  const production: { seq: number; input: ProgramConsistencyInput; expectFlagged: boolean }[] = [
    { seq: 1, input: prog({ executionStatus: "مكتمل", progress: 0, completedAt: null }), expectFlagged: true },
    { seq: 4, input: prog({ executionStatus: "مكتمل", progress: 0, completedAt: new Date("2026-07-30") }), expectFlagged: true },
    { seq: 7, input: prog({ executionStatus: "لم يبدأ", progress: 0, completedAt: null }), expectFlagged: false },
    { seq: 16, input: prog({ executionStatus: "مكتمل", progress: 100, completedAt: null }), expectFlagged: true },
    { seq: 29, input: prog({ executionStatus: "مكتمل", progress: 0, completedAt: null }), expectFlagged: true },
  ];

  it("يكشف أربعة سجلات متناقضة من أصل خمسة", () => {
    const flagged = production.filter((p) => isProgramInconsistent(p.input));
    expect(flagged.map((p) => p.seq)).toEqual([1, 4, 16, 29]);
  });

  it.each(production)("البرنامج $seq يُصنَّف كما هو متوقع", ({ input, expectFlagged }) => {
    expect(isProgramInconsistent(input)).toBe(expectFlagged);
  });

  it("seq 4 يُبلَّغ عنه بالقاعدة A وحدها (تاريخ الاكتمال موجود)", () => {
    const f = checkProgramConsistency(production[1].input);
    expect(f.map((x) => x.rule)).toEqual(["A"]);
  });

  it("seq 16 يُبلَّغ عنه بالقاعدة B وحدها (التقدم 100٪)", () => {
    const f = checkProgramConsistency(production[3].input);
    expect(f.map((x) => x.rule)).toEqual(["B"]);
  });
});

describe("المرشِّحات", () => {
  const completedZero = prog({ executionStatus: "مكتمل", progress: 0, completedAt: null });
  const clean = prog({ executionStatus: "لم يبدأ", progress: 0 });

  it("«الكل» يمرّر كل سجل", () => {
    expect(matchesConsistencyFilter(clean, "all")).toBe(true);
    expect(matchesConsistencyFilter(completedZero, "all")).toBe(true);
  });

  it("«غير المتسقة فقط» يستبعد السجل السليم", () => {
    expect(matchesConsistencyFilter(clean, "inconsistent")).toBe(false);
    expect(matchesConsistencyFilter(completedZero, "inconsistent")).toBe(true);
  });

  it("المرشحات المتخصصة تطابق قاعدتها", () => {
    expect(matchesConsistencyFilter(completedZero, "completedBelow100")).toBe(true);
    expect(matchesConsistencyFilter(completedZero, "completedNoDate")).toBe(true);
    expect(matchesConsistencyFilter(completedZero, "fullNotCompleted")).toBe(false);
    expect(
      matchesConsistencyFilter(prog({ executionStatus: "قيد التنفيذ", progress: 100 }), "fullNotCompleted"),
    ).toBe(true);
  });
});

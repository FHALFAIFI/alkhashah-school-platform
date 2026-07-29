import "server-only";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import {
  planYears, programs, programDeliverables, programKpis,
  programRisks, planBudgetItems, programRoadmapCells, importRows, planSwotItems,
  calendars, calendarEvents, evidenceLinks,
} from "@/db/schema";
import { readWorkbook, cellText, cellNumber, findHeaderRow } from "./xlsx";
import type { ParsedRow, CommitResult } from "./framework";

/**
 * استيراد الخطة التشغيلية من مصنف «الخطة_التشغيلية_المتكاملة» —
 * القيم الرسمية (بما فيها التواريخ الهجرية ونهاية الخطة 5/1/1449هـ) تخزن حرفياً دون أي تعديل.
 * المعالم تشتق نصياً من عمود «المعالم ونقاط القياس» بأوزان متساوية افتراضية قابلة للتعديل
 * (الوزن ليس قيمة رسمية في المصدر).
 */

function colIndex(headers: string[], ...patterns: string[]): number {
  for (const p of patterns) {
    const i = headers.findIndex((h) => h.includes(p));
    if (i !== -1) return i;
  }
  return -1;
}

function sheetByName(sheets: Map<string, unknown[][]>, ...names: string[]): unknown[][] | null {
  for (const n of names) {
    for (const [key, value] of sheets) {
      if (key.includes(n)) return value;
    }
  }
  return null;
}

/**
 * قراءة ورقة «التحليل الرباعي» وحدها.
 *
 * تُستعمل من مسارين: تحليل المصنف الكامل، ومسار استيراد **التحليل الرباعي فقط**
 * (`parseSwotWorkbook`) الذي لا يلمس البرامج ولا المؤشرات ولا المخاطر إطلاقاً.
 * الورقة تحمل اسم «التحليل الرباعي» في المصنف المتكامل و«SWOT» في نسخة التحليل — كلاهما مقبول.
 * النص يُحفظ حرفياً كبقية القيم الرسمية.
 *
 * يعيد `null` إن لم توجد الورقة أصلاً (ليُميَّز عن ورقة موجودة بلا صفوف صالحة).
 */
function collectSwotRows(sheets: Map<string, unknown[][]>, rowCounterStart: number): { rows: ParsedRow[] } | null {
  const swotSheet = sheetByName(sheets, "التحليل الرباعي", "SWOT");
  if (!swotSheet) return null;

  const idx = findHeaderRow(swotSheet);
  const h = swotSheet[idx].map((c) => cellText(c));
  const c = {
    category: colIndex(h, "النوع"),
    code: colIndex(h, "الرمز"),
    item: colIndex(h, "العنصر"),
    implication: colIndex(h, "الدلالة"),
  };
  const rows: ParsedRow[] = [];
  let rowCounter = rowCounterStart;
  let order = 0;
  const seen = new Set<string>();
  for (let i = idx + 1; i < swotSheet.length; i++) {
    const r = swotSheet[i];
    const category = cellText(r?.[c.category]).trim();
    const code = cellText(r?.[c.code]).trim();
    const item = cellText(r?.[c.item]).trim();
    // الصف الصالح: نوع معروف ورمز ونص عنصر — الصفوف العنوانية والفارغة تُتجاهل
    if (!(SWOT_CATEGORIES as readonly string[]).includes(category) || !code || !item) continue;
    // تكرار الرمز داخل الملف نفسه يُتجاهل — الرمز مفتاح فريد داخل السنة
    if (seen.has(code)) continue;
    seen.add(code);
    rows.push({
      rowIndex: rowCounter++,
      raw: { النوع: category, الرمز: code, العنصر: item },
      mapped: {
        rowType: "swot" satisfies PlanRowType,
        category,
        code,
        item,
        implication: cellText(r[c.implication]).trim(),
        sortOrder: order++,
      },
      validation: { errors: [], warnings: [] },
      status: "جاهز",
    });
  }
  return { rows };
}

export type PlanRowType = "program" | "deliverable" | "kpi" | "risk" | "budget" | "roadmap" | "swot";

/** أنواع عناصر التحليل الرباعي كما ترد في المصدر الرسمي */
const SWOT_CATEGORIES = ["قوة", "ضعف", "فرصة", "تهديد"] as const;

export async function parsePlanWorkbook(data: Buffer): Promise<{ rows: ParsedRow[]; summary: Record<string, number> }> {
  const sheets = await readWorkbook(data);
  const rows: ParsedRow[] = [];
  let rowCounter = 0;
  const summary: Record<string, number> = {};

  // ————— البرامج: دمج «الخطة التشغيلية» + «تفاصيل البرامج التنفيذية» حسب م —————
  const mainSheet = sheetByName(sheets, "الخطة التشغيلية");
  if (!mainSheet) throw new Error("لم يعثر على ورقة «الخطة التشغيلية» في المصنف");
  const mainHeaderIdx = findHeaderRow(mainSheet);
  const mh = mainSheet[mainHeaderIdx].map((c) => cellText(c));
  const mCol = {
    seq: colIndex(mh, "م"),
    domain: colIndex(mh, "المجال"),
    generalGoal: colIndex(mh, "الهدف العام"),
    specificGoal: colIndex(mh, "الهدف الخاص"),
    name: colIndex(mh, "البرنامج أو المبادرة", "البرنامج"),
    rationale: colIndex(mh, "مبررات التنفيذ"),
    targetGroup: colIndex(mh, "الفئة المستهدفة"),
    mechanism: colIndex(mh, "آلية التنفيذ"),
    periodText: colIndex(mh, "فترة التنفيذ"),
    owner: colIndex(mh, "مسؤول التنفيذ"),
    participants: colIndex(mh, "المشاركون"),
    kpiText: colIndex(mh, "مؤشر النجاح"),
    targetText: colIndex(mh, "المستهدف وشرحه"),
    deliverableText: colIndex(mh, "المخرج المطلوب"),
    evidenceText: colIndex(mh, "الشواهد"),
    followupText: colIndex(mh, "متابعة التنفيذ"),
    externalRelation: colIndex(mh, "علاقته بنتائج"),
    expectedImpact: colIndex(mh, "الأثر المتوقع"),
    budget: colIndex(mh, "الميزانية"),
    notes: colIndex(mh, "ملاحظات المدير"),
  };

  const detailsSheet = sheetByName(sheets, "تفاصيل البرامج التنفيذية");
  const detailsBySeq = new Map<number, Record<string, string>>();
  if (detailsSheet) {
    const dIdx = findHeaderRow(detailsSheet);
    const dh = detailsSheet[dIdx].map((c) => cellText(c));
    const dCol = {
      seq: colIndex(dh, "م"),
      baseline: colIndex(dh, "خط الأساس"),
      target: colIndex(dh, "المستهدف"),
      indicator: colIndex(dh, "المؤشر"),
      priority: colIndex(dh, "الأولوية"),
      execStage: colIndex(dh, "مرحلة التنفيذ"),
      hijriStart: colIndex(dh, "تاريخ البدء"),
      hijriEnd: colIndex(dh, "تاريخ الانتهاء"),
      milestones: colIndex(dh, "المعالم ونقاط القياس"),
      pauses: colIndex(dh, "فترات التوقف"),
      explain: colIndex(dh, "شرح الأرقام"),
    };
    for (let i = dIdx + 1; i < detailsSheet.length; i++) {
      const r = detailsSheet[i];
      const seq = cellNumber(r?.[dCol.seq]);
      if (seq === null) continue;
      detailsBySeq.set(seq, {
        baseline: cellText(r[dCol.baseline]),
        target: cellText(r[dCol.target]),
        indicator: cellText(r[dCol.indicator]),
        priority: cellText(r[dCol.priority]),
        execStage: cellText(r[dCol.execStage]),
        hijriStart: cellText(r[dCol.hijriStart]),
        hijriEnd: cellText(r[dCol.hijriEnd]),
        milestones: cellText(r[dCol.milestones]),
        pauses: cellText(r[dCol.pauses]),
        explain: cellText(r[dCol.explain]),
      });
    }
  }

  let programCount = 0;
  for (let i = mainHeaderIdx + 1; i < mainSheet.length; i++) {
    const r = mainSheet[i];
    const seq = cellNumber(r?.[mCol.seq]);
    if (seq === null) continue;
    const details = detailsBySeq.get(seq) ?? {};
    const name = cellText(r[mCol.name]);
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!name) errors.push("اسم البرنامج فارغ");
    if (!cellText(r[mCol.domain])) errors.push("المجال فارغ");

    rows.push({
      rowIndex: rowCounter++,
      raw: { م: seq, البرنامج: name, المجال: cellText(r[mCol.domain]) },
      mapped: {
        rowType: "program" satisfies PlanRowType,
        seq,
        domain: cellText(r[mCol.domain]),
        generalGoal: cellText(r[mCol.generalGoal]),
        specificGoal: cellText(r[mCol.specificGoal]),
        name,
        rationale: cellText(r[mCol.rationale]),
        targetGroup: cellText(r[mCol.targetGroup]),
        mechanism: cellText(r[mCol.mechanism]),
        periodText: cellText(r[mCol.periodText]),
        ownerPosition: cellText(r[mCol.owner]),
        participants: cellText(r[mCol.participants]),
        kpiText: cellText(r[mCol.kpiText]),
        targetText: cellText(r[mCol.targetText]),
        deliverableText: cellText(r[mCol.deliverableText]),
        evidenceText: cellText(r[mCol.evidenceText]),
        followupText: cellText(r[mCol.followupText]),
        externalRelation: cellText(r[mCol.externalRelation]),
        expectedImpact: cellText(r[mCol.expectedImpact]),
        budget: cellNumber(r[mCol.budget]),
        principalNotes: cellText(r[mCol.notes]),
        ...details,
      },
      validation: { errors, warnings },
      status: errors.length > 0 ? "يحتاج مراجعة" : "جاهز",
    });
    programCount++;
  }
  summary["برامج"] = programCount;

  // ————— المخرجات والشواهد —————
  const delivSheet = sheetByName(sheets, "سجل المخرجات والشواهد");
  if (delivSheet) {
    const idx = findHeaderRow(delivSheet);
    const h = delivSheet[idx].map((c) => cellText(c));
    const c = {
      seq: colIndex(h, "م"),
      mainOutput: colIndex(h, "المخرج المطلوب"),
      acceptedEvidence: colIndex(h, "الشواهد المقبولة"),
      prepOwner: colIndex(h, "مسؤول إعداد"),
      keepOwner: colIndex(h, "مسؤول حفظ"),
      dueText: colIndex(h, "موعد التسليم"),
      storagePlace: colIndex(h, "مكان الحفظ"),
      readiness: colIndex(h, "حالة الجاهزية"),
      notes: colIndex(h, "ملاحظات المدير"),
    };
    let count = 0;
    for (let i = idx + 1; i < delivSheet.length; i++) {
      const r = delivSheet[i];
      const seq = cellNumber(r?.[c.seq]);
      if (seq === null) continue;
      rows.push({
        rowIndex: rowCounter++,
        raw: { م: seq, المخرج: cellText(r[c.mainOutput]) },
        mapped: {
          rowType: "deliverable" satisfies PlanRowType,
          programSeq: seq,
          mainOutput: cellText(r[c.mainOutput]),
          acceptedEvidence: cellText(r[c.acceptedEvidence]),
          prepOwner: cellText(r[c.prepOwner]),
          keepOwner: cellText(r[c.keepOwner]),
          dueText: cellText(r[c.dueText]),
          storagePlace: cellText(r[c.storagePlace]),
          principalNotes: cellText(r[c.notes]),
        },
        validation: { errors: [], warnings: [] },
        status: "جاهز",
      });
      count++;
    }
    summary["مخرجات"] = count;
  }

  // ————— مؤشرات الأداء —————
  const kpiSheet = sheetByName(sheets, "مؤشرات الأداء");
  if (kpiSheet) {
    const idx = findHeaderRow(kpiSheet);
    const h = kpiSheet[idx].map((c) => cellText(c));
    const c = {
      code: colIndex(h, "الرمز"),
      name: colIndex(h, "المؤشر"),
      baseline: colIndex(h, "خط الأساس"),
      target: colIndex(h, "المستهدف"),
      periodicity: colIndex(h, "الدورية"),
      owner: colIndex(h, "المالك"),
      source: colIndex(h, "مصدر البيانات"),
      direction: colIndex(h, "اتجاه النجاح"),
      measureDates: colIndex(h, "مواعيد القياس"),
      reviewDecision: colIndex(h, "قرار المراجعة"),
    };
    let count = 0;
    for (let i = idx + 1; i < kpiSheet.length; i++) {
      const r = kpiSheet[i];
      const code = cellText(r?.[c.code]);
      if (!code || !code.startsWith("مؤشر")) continue;
      rows.push({
        rowIndex: rowCounter++,
        raw: { الرمز: code, المؤشر: cellText(r[c.name]) },
        mapped: {
          rowType: "kpi" satisfies PlanRowType,
          code,
          nameAr: cellText(r[c.name]),
          baseline: cellText(r[c.baseline]),
          target: cellText(r[c.target]),
          periodicity: cellText(r[c.periodicity]),
          owner: cellText(r[c.owner]),
          dataSource: cellText(r[c.source]),
          direction: cellText(r[c.direction]),
          measureDates: cellText(r[c.measureDates]),
          reviewDecision: cellText(r[c.reviewDecision]),
        },
        validation: { errors: [], warnings: [] },
        status: "جاهز",
      });
      count++;
    }
    summary["مؤشرات"] = count;
  }

  // ————— سجل المخاطر —————
  const riskSheet = sheetByName(sheets, "سجل المخاطر");
  if (riskSheet) {
    const idx = findHeaderRow(riskSheet);
    const h = riskSheet[idx].map((c) => cellText(c));
    const c = {
      code: colIndex(h, "الرمز"),
      risk: colIndex(h, "الخطر"),
      likelihood: colIndex(h, "الاحتمالية"),
      impact: colIndex(h, "الأثر"),
      classification: colIndex(h, "التصنيف"),
      treatment: colIndex(h, "المعالجة"),
      owner: colIndex(h, "المالك"),
    };
    let count = 0;
    for (let i = idx + 1; i < riskSheet.length; i++) {
      const r = riskSheet[i];
      const code = cellText(r?.[c.code]);
      if (!code || !code.startsWith("خطر")) continue;
      rows.push({
        rowIndex: rowCounter++,
        raw: { الرمز: code, الخطر: cellText(r[c.risk]) },
        mapped: {
          rowType: "risk" satisfies PlanRowType,
          code,
          risk: cellText(r[c.risk]),
          likelihood: cellText(r[c.likelihood]),
          impact: cellText(r[c.impact]),
          classification: cellText(r[c.classification]),
          treatment: cellText(r[c.treatment]),
          owner: cellText(r[c.owner]),
        },
        validation: { errors: [], warnings: [] },
        status: "جاهز",
      });
      count++;
    }
    summary["مخاطر"] = count;
  }

  // ————— التحليل الرباعي (SWOT) —————
  const swotRows = collectSwotRows(sheets, rowCounter);
  if (swotRows) {
    rows.push(...swotRows.rows);
    rowCounter += swotRows.rows.length;
    summary["عناصر التحليل الرباعي"] = swotRows.rows.length;
  }

  // ————— الميزانية —————
  const budgetSheet = sheetByName(sheets, "الميزانية");
  if (budgetSheet) {
    const idx = findHeaderRow(budgetSheet);
    const h = budgetSheet[idx].map((c) => cellText(c));
    const c = {
      item: colIndex(h, "البند"),
      amount: colIndex(h, "المبلغ"),
      ratio: colIndex(h, "النسبة"),
      rule: colIndex(h, "القاعدة"),
      notes: colIndex(h, "ملاحظات"),
    };
    let count = 0;
    for (let i = idx + 1; i < budgetSheet.length; i++) {
      const r = budgetSheet[i];
      const item = cellText(r?.[c.item]);
      if (!item || item.includes("الإجمالي")) continue;
      rows.push({
        rowIndex: rowCounter++,
        raw: { البند: item },
        mapped: {
          rowType: "budget" satisfies PlanRowType,
          item,
          amount: cellNumber(r[c.amount]),
          ratio: cellNumber(r[c.ratio]),
          rule: cellText(r[c.rule]),
          notes: cellText(r[c.notes]),
        },
        validation: { errors: [], warnings: [] },
        status: "جاهز",
      });
      count++;
    }
    summary["بنود ميزانية"] = count;
  }

  // ————— خارطة التنفيذ السنوية —————
  const roadmapSheet = sheetByName(sheets, "خارطة التنفيذ السنوية");
  if (roadmapSheet) {
    const idx = findHeaderRow(roadmapSheet);
    const h = roadmapSheet[idx].map((c) => cellText(c));
    const seqCol = colIndex(h, "م");
    const nonPeriod = new Set(["م", "البرنامج", "مسؤول التنفيذ", "المخرج الختامي", "حالة التنفيذ", "ملاحظات المدير", "الأدلة الرئيسة"]);
    const periodCols = h
      .map((label, i) => ({ label, i }))
      .filter(({ label }) => label && !nonPeriod.has(label));
    let count = 0;
    for (let i = idx + 1; i < roadmapSheet.length; i++) {
      const r = roadmapSheet[i];
      const seq = cellNumber(r?.[seqCol]);
      if (seq === null) continue;
      const cells = periodCols
        .map(({ label, i: colI }, order) => ({ periodKey: `p${order}`, periodLabel: label, phase: cellText(r[colI]), sortOrder: order }))
        .filter((c) => c.phase);
      rows.push({
        rowIndex: rowCounter++,
        raw: { م: seq },
        mapped: { rowType: "roadmap" satisfies PlanRowType, programSeq: seq, cells },
        validation: { errors: [], warnings: [] },
        status: "جاهز",
      });
      count++;
    }
    summary["صفوف خارطة"] = count;
  }

  return { rows, summary };
}

/**
 * مسار مضبوط: استيراد **التحليل الرباعي وحده** من مصنف الخطة (v2.2 §D / D-030).
 *
 * لماذا مسار مستقل بدل إعادة استيراد المصنف كاملاً: البرامج مقيَّدة بـ(السنة، م) فريدة،
 * فإعادة استيراد المصنف نفسه على سنة قائمة **تفشل بالكامل** (المعاملة تُلغى ولا يُكتب شيء —
 * سلوك آمن لكنه يعني أن التحليل الرباعي لا يمكن أن يصل بهذا الطريق). هذا المسار يقرأ ورقة
 * «التحليل الرباعي» فقط ويكتب في `plan_swot_items` فقط، فلا يستطيع — بالبناء لا بالإعداد —
 * أن يلمس برنامجاً أو مؤشراً أو خطراً أو مخرجاً أو بند ميزانية أو خلية خارطة.
 */
export async function parseSwotWorkbook(data: Buffer): Promise<{ rows: ParsedRow[]; summary: Record<string, number> }> {
  const sheets = await readWorkbook(data);
  const collected = collectSwotRows(sheets, 0);
  if (!collected) {
    throw new Error("لم يعثر على ورقة «التحليل الرباعي» في المصنف — اختر مصنف الخطة التشغيلية المتكامل");
  }
  if (collected.rows.length === 0) {
    throw new Error("ورقة «التحليل الرباعي» موجودة لكنها بلا عناصر صالحة — تحقق من أعمدة النوع والرمز والعنصر");
  }
  return { rows: collected.rows, summary: { "عناصر التحليل الرباعي": collected.rows.length } };
}

/**
 * تنفيذ دفعة التحليل الرباعي — **لا ينشئ سنة تخطيطية ولا يكتب في أي جدول آخر**.
 *
 * تُشترط سنة تخطيطية قائمة: التحليل الرباعي تابع للخطة، واستيراده قبل الخطة يعني إنشاء سنة
 * فارغة لا معنى لها. الرسالة عربية صريحة بدل إنشاء صامت.
 */
export async function commitSwotRows(
  tx: Tx,
  rows: { id: string; mapped: Record<string, unknown> }[],
  batchId: string,
): Promise<CommitResult> {
  const years = await tx.select().from(planYears);
  const year = years.find((y) => y.status === "نشطة") ?? years[0];
  if (!year) {
    throw new Error("لا توجد سنة تخطيطية — استورد الخطة التشغيلية أولاً ثم استورد التحليل الرباعي");
  }

  const summary: Record<string, number> = {};
  const bump = (k: string) => (summary[k] = (summary[k] ?? 0) + 1);

  for (const row of rows) {
    const m = row.mapped;
    if (m.rowType !== "swot") continue;
    // الرمز فريد داخل السنة؛ الصف القائم لا يُعاد كتابته ولا يُنسب لهذه الدفعة،
    // فالتراجع عنها لا يحذف عنصراً أنشأته دفعة سابقة.
    const inserted = await tx
      .insert(planSwotItems)
      .values({
        planYearId: year.id,
        category: String(m.category),
        code: String(m.code),
        item: String(m.item),
        implication: (m.implication as string) || null,
        sortOrder: Number(m.sortOrder ?? 0),
        importBatchId: batchId,
      })
      .onConflictDoNothing({ target: [planSwotItems.planYearId, planSwotItems.code] })
      .returning();
    const created = inserted[0];
    await tx
      .update(importRows)
      .set(
        created
          ? { status: "منفذ", createdEntityType: "plan_swot_item", createdEntityId: created.id }
          : { status: "منفذ", createdEntityType: null, createdEntityId: null },
      )
      .where(eq(importRows.id, row.id));
    if (created) bump("عناصر التحليل الرباعي");
    else bump("عناصر موجودة مسبقاً (لم تتغيّر)");
  }

  return { createdSummary: summary };
}

/** التراجع عن دفعة التحليل الرباعي — يحذف ما أنشأته هذه الدفعة فقط */
export async function rollbackSwotBatch(tx: Tx, batchId: string): Promise<void> {
  const rows = await tx
    .select({ type: importRows.createdEntityType, id: importRows.createdEntityId })
    .from(importRows)
    .where(and(eq(importRows.batchId, batchId), isNotNull(importRows.createdEntityId)));
  const ids = rows.filter((r) => r.type === "plan_swot_item").map((r) => r.id!) as string[];
  if (ids.length > 0) await tx.delete(planSwotItems).where(inArray(planSwotItems.id, ids));
  await tx
    .update(importRows)
    .set({ status: "جاهز", createdEntityType: null, createdEntityId: null })
    .where(and(eq(importRows.batchId, batchId), isNotNull(importRows.createdEntityType)));
}

/** اشتقاق معالم افتراضية من نص المصدر — أوزان متساوية مجموعها 100 (قابلة للتعديل) */
export function deriveMilestones(milestonesText: string): { title: string; weight: number }[] {
  const parts = milestonesText
    .split(/[;؛\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return [];
  const base = Math.floor(100 / parts.length);
  const remainder = 100 - base * parts.length;
  return parts.map((title, i) => ({ title, weight: base + (i === 0 ? remainder : 0) }));
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function commitPlanRows(
  tx: Tx,
  rows: { id: string; mapped: Record<string, unknown> }[],
  batchId: string,
  opts: { planYearKey: string; planYearName: string; createdBy: string },
): Promise<CommitResult> {
  // السنة التخطيطية مع لقطة التقويم المعتمد
  let [year] = await tx.select().from(planYears).where(eq(planYears.key, opts.planYearKey));
  if (!year) {
    const [cal] = await tx.select().from(calendars).where(eq(calendars.calendarType, "academic"));
    let snapshot: unknown = null;
    if (cal) {
      const events = await tx.select().from(calendarEvents).where(eq(calendarEvents.calendarId, cal.id));
      snapshot = { calendarKey: cal.key, nameAr: cal.nameAr, events };
    }
    [year] = await tx
      .insert(planYears)
      .values({
        key: opts.planYearKey,
        nameAr: opts.planYearName,
        calendarId: cal?.id,
        calendarSnapshot: snapshot as object,
      })
      .returning();
  }

  const summary: Record<string, number> = {};
  const bump = (k: string) => (summary[k] = (summary[k] ?? 0) + 1);
  const programIdBySeq = new Map<number, string>();

  // البرامج أولاً
  for (const row of rows) {
    const m = row.mapped;
    if (m.rowType !== "program") continue;
    const seq = Number(m.seq);
    const [p] = await tx
      .insert(programs)
      .values({
        planYearId: year.id,
        seq,
        domain: String(m.domain),
        generalGoal: (m.generalGoal as string) || null,
        specificGoal: (m.specificGoal as string) || null,
        name: String(m.name),
        rationale: (m.rationale as string) || null,
        targetGroup: (m.targetGroup as string) || null,
        mechanism: (m.mechanism as string) || null,
        periodText: (m.periodText as string) || null,
        ownerPosition: (m.ownerPosition as string) || null,
        participants: (m.participants as string) || null,
        kpiText: (m.kpiText as string) || null,
        targetText: (m.targetText as string) || null,
        deliverableText: (m.deliverableText as string) || null,
        evidenceText: (m.evidenceText as string) || null,
        followupText: (m.followupText as string) || null,
        externalRelation: (m.externalRelation as string) || null,
        expectedImpact: (m.expectedImpact as string) || null,
        budget: m.budget !== null && m.budget !== undefined ? String(m.budget) : null,
        priority: (m.priority as string) || null,
        baselineText: (m.baseline as string) || null,
        indicatorText: (m.indicator as string) || null,
        executionStage: (m.execStage as string) || null,
        hijriStart: (m.hijriStart as string) || null,
        hijriEnd: (m.hijriEnd as string) || null,
        pausePeriods: (m.pauses as string) || null,
        targetExplanation: (m.explain as string) || null,
        principalNotes: (m.principalNotes as string) || null,
        importBatchId: batchId,
      })
      .returning();
    programIdBySeq.set(seq, p.id);
    bump("برامج");

    // الاستيراد لم يعد يُنشئ أنشطة (D-024): البرنامج نفسه وحدة التنفيذ والمتابعة، والتقدم
    // يُدخل مباشرةً على البرنامج بعد الاستيراد. نص «المعالم ونقاط القياس» يبقى محفوظاً
    // كقيمة رسمية من المصدر في حقول البرنامج، بلا اشتقاق أنشطة موزونة.
    await tx
      .update(importRows)
      .set({ status: "منفذ", createdEntityType: "program", createdEntityId: p.id })
      .where(eq(importRows.id, row.id));
  }

  // بقية الأنواع
  for (const row of rows) {
    const m = row.mapped;
    switch (m.rowType) {
      case "deliverable": {
        const programId = programIdBySeq.get(Number(m.programSeq));
        if (!programId) break;
        const [d] = await tx
          .insert(programDeliverables)
          .values({
            programId,
            mainOutput: (m.mainOutput as string) || null,
            acceptedEvidence: (m.acceptedEvidence as string) || null,
            prepOwner: (m.prepOwner as string) || null,
            keepOwner: (m.keepOwner as string) || null,
            dueText: (m.dueText as string) || null,
            storagePlace: (m.storagePlace as string) || null,
            packageNumber: `حزمة-${String(m.programSeq).padStart(2, "0")}`,
            principalNotes: (m.principalNotes as string) || null,
          })
          .returning();
        await tx
          .update(importRows)
          .set({ status: "منفذ", createdEntityType: "program_deliverable", createdEntityId: d.id })
          .where(eq(importRows.id, row.id));
        bump("مخرجات");
        break;
      }
      case "kpi": {
        const [k] = await tx
          .insert(programKpis)
          .values({
            planYearId: year.id,
            code: String(m.code),
            nameAr: String(m.nameAr),
            baseline: (m.baseline as string) || null,
            target: (m.target as string) || null,
            periodicity: (m.periodicity as string) || null,
            owner: (m.owner as string) || null,
            dataSource: (m.dataSource as string) || null,
            direction: (m.direction as string) || null,
            measureDates: (m.measureDates as string) || null,
            reviewDecision: (m.reviewDecision as string) || null,
          })
          .returning();
        await tx
          .update(importRows)
          .set({ status: "منفذ", createdEntityType: "program_kpi", createdEntityId: k.id })
          .where(eq(importRows.id, row.id));
        bump("مؤشرات");
        break;
      }
      case "swot": {
        /**
         * الرمز فريد داخل السنة، فإعادة استيراد المصنف نفسه لا تُنشئ نسخاً مكررة.
         *
         * `onConflictDoNothing` مقصود بدل التحديث: النص رسمي ولا يُعاد كتابته صامتاً من
         * دفعة لاحقة. والأهم أن الصف الموجود مسبقاً **لا يُنسب** لهذه الدفعة، فالتراجع
         * عنها لا يحذف عنصراً أنشأته دفعة سابقة.
         */
        const inserted = await tx
          .insert(planSwotItems)
          .values({
            planYearId: year.id,
            category: String(m.category),
            code: String(m.code),
            item: String(m.item),
            implication: (m.implication as string) || null,
            sortOrder: Number(m.sortOrder ?? 0),
            importBatchId: batchId,
          })
          .onConflictDoNothing({ target: [planSwotItems.planYearId, planSwotItems.code] })
          .returning();
        const created = inserted[0];
        await tx
          .update(importRows)
          .set(
            created
              ? { status: "منفذ", createdEntityType: "plan_swot_item", createdEntityId: created.id }
              : { status: "منفذ", createdEntityType: null, createdEntityId: null },
          )
          .where(eq(importRows.id, row.id));
        if (created) bump("عناصر التحليل الرباعي");
        break;
      }
      case "risk": {
        const [k] = await tx
          .insert(programRisks)
          .values({
            planYearId: year.id,
            code: String(m.code),
            risk: String(m.risk),
            likelihood: (m.likelihood as string) || null,
            impact: (m.impact as string) || null,
            classification: (m.classification as string) || null,
            treatment: (m.treatment as string) || null,
            owner: (m.owner as string) || null,
          })
          .returning();
        await tx
          .update(importRows)
          .set({ status: "منفذ", createdEntityType: "program_risk", createdEntityId: k.id })
          .where(eq(importRows.id, row.id));
        bump("مخاطر");
        break;
      }
      case "budget": {
        const [b] = await tx
          .insert(planBudgetItems)
          .values({
            planYearId: year.id,
            item: String(m.item),
            amount: m.amount !== null && m.amount !== undefined ? String(m.amount) : null,
            ratio: m.ratio !== null && m.ratio !== undefined ? String(m.ratio) : null,
            rule: (m.rule as string) || null,
            notes: (m.notes as string) || null,
          })
          .returning();
        await tx
          .update(importRows)
          .set({ status: "منفذ", createdEntityType: "plan_budget_item", createdEntityId: b.id })
          .where(eq(importRows.id, row.id));
        bump("بنود ميزانية");
        break;
      }
      case "roadmap": {
        const programId = programIdBySeq.get(Number(m.programSeq));
        if (!programId) break;
        const cells = (m.cells ?? []) as { periodKey: string; periodLabel: string; phase: string; sortOrder: number }[];
        for (const c of cells) {
          await tx.insert(programRoadmapCells).values({
            programId,
            periodKey: c.periodKey,
            periodLabel: c.periodLabel,
            phase: c.phase,
            sortOrder: c.sortOrder,
          });
          bump("خلايا خارطة");
        }
        await tx.update(importRows).set({ status: "منفذ" }).where(eq(importRows.id, row.id));
        break;
      }
    }
  }

  return { createdSummary: summary };
}

/** التراجع آمن فقط قبل اعتماد أي برنامج أو ربط شواهد — يحذف كل ما أنشأته الدفعة عبر تتبع الصفوف */
export async function rollbackPlanBatch(tx: Tx, batchId: string): Promise<void> {
  const imported = await tx.select({ id: programs.id, status: programs.status }).from(programs).where(eq(programs.importBatchId, batchId));
  if (imported.some((p) => p.status !== "مسودة")) {
    throw new Error("لا يمكن التراجع: برامج من هذه الدفعة معتمدة أو مقفلة");
  }
  const programIds = imported.map((p) => p.id);
  if (programIds.length > 0) {
    const linked = await tx
      .select({ id: evidenceLinks.id })
      .from(evidenceLinks)
      .where(and(eq(evidenceLinks.entityType, "program"), inArray(evidenceLinks.entityId, programIds)))
      .limit(1);
    if (linked.length > 0) throw new Error("لا يمكن التراجع: توجد شواهد مرتبطة ببرامج من هذه الدفعة");
  }

  const rows = await tx
    .select({ type: importRows.createdEntityType, id: importRows.createdEntityId })
    .from(importRows)
    .where(and(eq(importRows.batchId, batchId), isNotNull(importRows.createdEntityId)));
  const byType = (t: string) => rows.filter((r) => r.type === t).map((r) => r.id!) as string[];

  const kpiIds = byType("program_kpi");
  if (kpiIds.length > 0) await tx.delete(programKpis).where(inArray(programKpis.id, kpiIds));
  const riskIds = byType("program_risk");
  if (riskIds.length > 0) await tx.delete(programRisks).where(inArray(programRisks.id, riskIds));
  const budgetIds = byType("plan_budget_item");
  if (budgetIds.length > 0) await tx.delete(planBudgetItems).where(inArray(planBudgetItems.id, budgetIds));
  // عناصر التحليل الرباعي تُحذف بمعرّفاتها فقط — التراجع لا يمسّ عنصراً أنشأته دفعة أخرى
  const swotIds = byType("plan_swot_item");
  if (swotIds.length > 0) await tx.delete(planSwotItems).where(inArray(planSwotItems.id, swotIds));
  // الاستيراد لم يعد يُنشئ أنشطة (D-024)، فلا حذف لها هنا؛ وأي أنشطة قديمة محفوظة للتدقيق
  // والتراجع لا تُحذف مع الدفعة. المصروفات/الإيرادات المرتبطة تُفكّ إلى null بقيد set null.
  if (programIds.length > 0) {
    // حذف البرامج يتسلسل إلى المخرجات وخلايا الخارطة والمتابعات (FK cascade)
    await tx.delete(programs).where(inArray(programs.id, programIds));
  }

  await tx
    .update(importRows)
    .set({ status: "جاهز", createdEntityType: null, createdEntityId: null })
    .where(and(eq(importRows.batchId, batchId), isNotNull(importRows.createdEntityType)));
}

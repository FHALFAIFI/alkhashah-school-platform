import "server-only";
import { eq, and, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { people, importRows } from "@/db/schema";
import { readWorkbook, cellText, findHeaderRow } from "./xlsx";
import { CLASSIFICATION_WARNING } from "./validation-display";
import { peopleBatchDependencies, dependencySummaryAr } from "./people-dependencies";
import type { ParsedRow, CommitResult } from "./framework";

/**
 * استيراد بيانات الموظفين (ملف فارس) مع تصغير البيانات:
 * يستورد افتراضياً: الاسم، الوظيفة، السلك/الكادر، حالة الموظف، المرحلة/الجهة، رقم الوظيفة.
 * لا يستورد افتراضياً: رقم الهوية، تاريخ الميلاد، هوية المدير المباشر، رقم الجوال.
 */

/**
 * أسماء الأعمدة المتوقعة — مطابقة مرنة بالاحتواء.
 * الأنماط الأكثر تحديداً أولاً (رقم الوظيفة قبل الوظيفة، هوية المدير قبل رقم الهوية).
 */
const COLUMN_PATTERNS: { field: string; label: string; patterns: string[]; sensitive: boolean }[] = [
  { field: "jobNumber", label: "رقم الوظيفة", patterns: ["رقم الوظيفة", "الرقم الوظيفي"], sensitive: false },
  { field: "managerNationalId", label: "هوية المدير المباشر", patterns: ["هوية المدير", "الرئيس المباشر"], sensitive: true },
  { field: "nationalId", label: "رقم الهوية", patterns: ["رقم الهوية", "السجل المدني", "الهوية الوطنية"], sensitive: true },
  { field: "birthDate", label: "تاريخ الميلاد", patterns: ["تاريخ الميلاد", "الميلاد"], sensitive: true },
  { field: "mobile", label: "رقم الجوال", patterns: ["الجوال", "رقم الجوال", "الهاتف"], sensitive: true },
  { field: "fullName", label: "الاسم", patterns: ["الاسم", "اسم الموظف"], sensitive: false },
  { field: "jobTitle", label: "الوظيفة", patterns: ["الوظيفة الحالية", "المسمى الوظيفي", "الوظيفة", "العمل الحالي"], sensitive: false },
  { field: "cadre", label: "السلك/الكادر", patterns: ["السلك", "الكادر", "المرتبة", "المستوى"], sensitive: false },
  { field: "employmentStatus", label: "حالة الموظف", patterns: ["حالة الموظف", "الحالة الوظيفية", "حالة"], sensitive: false },
  { field: "orgUnit", label: "المرحلة/الجهة", patterns: ["المرحلة", "الجهة", "مقر العمل", "المدرسة", "الوحدة"], sensitive: false },
];

/** الكلمات الدالة على الكادر التعليمي في مسمى الوظيفة */
const TEACHER_HINTS = ["معلم", "مدرس", "موجه طلابي", "وكيل", "مدير مدرسة", "محضر مختبر", "أمين مصادر", "رائد نشاط", "مرشد"];

export function classifyCategory(jobTitle: string, cadre: string): { category: "معلم" | "موظف"; confident: boolean } {
  const title = jobTitle + " " + cadre;
  if (TEACHER_HINTS.some((h) => title.includes(h))) return { category: "معلم", confident: true };
  if (cadre.includes("تعليمي")) return { category: "معلم", confident: true };
  if (cadre.includes("إداري") || cadre.includes("اداري")) return { category: "موظف", confident: true };
  return { category: "موظف", confident: false };
}

/** اقتراح نموذج الأداء من المسمى — يتطلب تأكيد المدير دائماً */
export function suggestModelKey(jobTitle: string): string | null {
  const t = jobTitle.trim();
  if (t.includes("مدير")) return "school-principal";
  if (t.includes("وكيل")) return "school-vice";
  if (t.includes("توجيه صحي") || t.includes("موجه صحي") || t.includes("مرشد صحي")) return "health-advisor";
  if (t.includes("موجه طلابي") || t.includes("مرشد")) return "student-advisor";
  if (t.includes("رائد نشاط")) return "activity-leader";
  if (t.includes("رياض أطفال") || t.includes("رياض الأطفال") || t.includes("روضة") || t.includes("طفولة مبكرة")) return "kindergarten-teacher";
  if (t.includes("أمين مصادر") || t.includes("امين مصادر")) return "lrc-specialist";
  if (t.includes("محضر مختبر")) return "lab-technician";
  if (t.includes("معلم") || t.includes("مدرس")) return "teacher";
  return null;
}

export async function parsePeopleWorkbook(data: Buffer): Promise<{
  rows: ParsedRow[];
  columnMapping: Record<string, number>;
  detectedColumns: { header: string; field: string | null; sensitive: boolean }[];
}> {
  const sheets = await readWorkbook(data);
  const first = [...sheets.values()][0];
  if (!first || first.length === 0) throw new Error("المصنف فارغ أو تعذرت قراءته");

  const headerIdx = findHeaderRow(first);
  if (headerIdx === -1) throw new Error("تعذر إيجاد صف العناوين في الملف");
  const headers = first[headerIdx].map((h) => cellText(h));

  const columnMapping: Record<string, number> = {};
  const detectedColumns = headers.map((header, i) => {
    let field: string | null = null;
    let sensitive = false;
    for (const cp of COLUMN_PATTERNS) {
      if (cp.patterns.some((p) => header.includes(p))) {
        // أول عمود مطابق فقط
        if (!(cp.field in columnMapping)) {
          columnMapping[cp.field] = i;
          field = cp.field;
          sensitive = cp.sensitive;
        }
        break;
      }
    }
    return { header, field, sensitive };
  });

  if (!("fullName" in columnMapping)) throw new Error("لم يعثر على عمود الاسم في الملف");

  const seenNames = new Map<string, number>();
  const seenJobNumbers = new Map<string, number>();
  const rows: ParsedRow[] = [];
  for (let i = headerIdx + 1; i < first.length; i++) {
    const r = first[i];
    if (!r) continue;
    const fullName = cellText(r[columnMapping.fullName]);
    if (!fullName) continue;

    // تصغير البيانات: الأعمدة الحساسة لا تدخل في raw ولا mapped إطلاقاً افتراضياً
    const raw: Record<string, unknown> = {};
    detectedColumns.forEach((c, idx) => {
      if (!c.sensitive && cellText(r[idx])) raw[c.header] = cellText(r[idx]);
    });

    const jobTitle = "jobTitle" in columnMapping ? cellText(r[columnMapping.jobTitle]) : "";
    const cadre = "cadre" in columnMapping ? cellText(r[columnMapping.cadre]) : "";
    const { category, confident } = classifyCategory(jobTitle, cadre);
    const jobNumber = "jobNumber" in columnMapping ? cellText(r[columnMapping.jobNumber]) : "";

    const errors: string[] = [];
    const warnings: string[] = [];
    if (!jobTitle) warnings.push("المسمى الوظيفي فارغ");
    if (!confident) warnings.push(CLASSIFICATION_WARNING);

    const dupName = seenNames.get(fullName);
    if (dupName !== undefined) warnings.push(`اسم مكرر مع الصف ${dupName + 1}`);
    seenNames.set(fullName, i);
    if (jobNumber) {
      const dupJob = seenJobNumbers.get(jobNumber);
      if (dupJob !== undefined) errors.push(`رقم وظيفة مكرر مع الصف ${dupJob + 1}`);
      seenJobNumbers.set(jobNumber, i);
    }

    rows.push({
      rowIndex: i,
      raw,
      mapped: {
        fullName,
        jobTitle,
        cadre,
        employmentStatus: "employmentStatus" in columnMapping ? cellText(r[columnMapping.employmentStatus]) : "",
        orgUnit: "orgUnit" in columnMapping ? cellText(r[columnMapping.orgUnit]) : "",
        jobNumber,
        category,
        suggestedModelKey: suggestModelKey(jobTitle),
      },
      validation: { errors, warnings },
      status: errors.length > 0 ? "يحتاج مراجعة" : warnings.length > 0 ? "يحتاج مراجعة" : "جاهز",
    });
  }

  return { rows, columnMapping, detectedColumns };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function commitPeopleRows(
  tx: Tx,
  rows: { id: string; mapped: Record<string, unknown> }[],
  batchId: string,
  createdBy: string,
): Promise<CommitResult> {
  let created = 0;
  for (const row of rows) {
    const m = row.mapped;
    const [p] = await tx
      .insert(people)
      .values({
        fullName: String(m.fullName),
        category: String(m.category ?? "موظف"),
        jobTitle: (m.jobTitle as string) || null,
        cadre: (m.cadre as string) || null,
        employmentStatus: (m.employmentStatus as string) || null,
        orgUnit: (m.orgUnit as string) || null,
        jobNumber: (m.jobNumber as string) || null,
        suggestedModelKey: (m.suggestedModelKey as string) || null,
        importBatchId: batchId,
        createdBy,
      })
      .returning();
    await tx
      .update(importRows)
      .set({ status: "منفذ", createdEntityType: "person", createdEntityId: p.id })
      .where(eq(importRows.id, row.id));
    created++;
  }
  return { createdSummary: { أشخاص: created } };
}

/**
 * التراجع الكامل آمن فقط إن لم يرتبط أي شخص من الدفعة بسجل عمل لاحق.
 *
 * الحارس النهائي (داخل المعاملة): يفحص كل مواضع الإشارة لمعرّف الشخص عبر
 * `peopleBatchDependencies`. إن وُجدت أي تبعية يُرفض التراجع ولا يُحذف/يُعدّل أي سجل عمل
 * (لا حذف تعاقبي) — يُوجَّه المستخدم لتصحيح/تعطيل الموظف فردياً. غياب التبعيات فقط يسمح
 * بحذف الأشخاص وإعادة صفوف الدفعة إلى «جاهز».
 */
export async function rollbackPeopleBatch(tx: Tx, batchId: string): Promise<void> {
  const { importedCount, dependencies, blocked } = await peopleBatchDependencies(tx, batchId);
  if (importedCount === 0) return;
  if (blocked) {
    throw new Error(
      `لا يمكن التراجع الكامل عن الدفعة — توجد سجلات عمل مرتبطة بموظفين منها (${dependencySummaryAr(dependencies)}). ` +
        "لن تُحذف هذه السجلات ولن تُعدّل. استخدم تصحيح بيانات الموظف أو تعطيله فردياً بدلاً من التراجع الكامل عن الدفعة.",
    );
  }
  await tx.delete(people).where(eq(people.importBatchId, batchId));
  await tx
    .update(importRows)
    .set({ status: "جاهز", createdEntityType: null, createdEntityId: null })
    .where(and(eq(importRows.batchId, batchId), isNotNull(importRows.createdEntityId)));
}

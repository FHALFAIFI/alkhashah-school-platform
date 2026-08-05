import "server-only";
import { asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  committees,
  financialItems,
  people,
  perfCycles,
  planYears,
  programs,
} from "@/db/schema";
import { EMPLOYEE_TYPES } from "@/lib/employee-type";
import { recentWeekKeys } from "@/lib/plan/followup";
import { orFallback } from "@/lib/format";
import type { FilterKey } from "./filters";
import type { FilterOptions } from "@/components/report-filters";

/**
 * خيارات المرشّحات (v2.5.0 §3) — تُحمَّل من قاعدة البيانات حسب ما يطلبه التقرير فعلاً.
 *
 * قاعدتان:
 *  1. **لا استعلام بلا داعٍ.** لا يُحمَّل إلا ما أعلنه التقرير من مفاتيح، فصفحة تعرض
 *     مرشّحين لا تدفع ثمن أحد عشر استعلاماً.
 *  2. **القيم من البيانات نفسها.** المجالات والمسميات والأقسام تُقرأ متمايزةً من الجداول
 *     لا من قائمة مكتوبة يدوياً تتقادم. القوائم المغلقة (الحالات، نوع الموظف) تبقى
 *     ثوابت معلَنة فلا تتسرّب قيمة غير متوقعة إلى عنصر الاختيار.
 */
export async function loadFilterOptions(keys: readonly FilterKey[], opts?: { statuses?: string[] }): Promise<FilterOptions> {
  const need = new Set(keys);
  const out: FilterOptions = {};

  if (opts?.statuses?.length) out.status = opts.statuses;
  if (need.has("employeeType")) out.employeeTypes = [...EMPLOYEE_TYPES];
  if (need.has("week")) out.weeks = recentWeekKeys(12);

  const jobs: Promise<void>[] = [];

  if (need.has("person")) {
    jobs.push(
      db
        .select({ id: people.id, name: people.fullName })
        .from(people)
        .where(eq(people.active, true))
        .orderBy(asc(people.fullName))
        .then((rows) => {
          out.people = rows.map((r) => ({ value: r.id, label: orFallback(r.name, "بدون اسم") }));
        }),
    );
  }

  if (need.has("item")) {
    jobs.push(
      db
        .select({ id: financialItems.id, name: financialItems.nameAr })
        .from(financialItems)
        .where(isNull(financialItems.archivedAt))
        .orderBy(asc(financialItems.sortOrder))
        .then((rows) => {
          out.items = rows.map((r) => ({ value: r.id, label: orFallback(r.name, "بند بدون اسم") }));
        }),
    );
  }

  if (need.has("domain")) {
    jobs.push(
      db
        .selectDistinct({ domain: programs.domain })
        .from(programs)
        .where(isNull(programs.archivedAt))
        .then((rows) => {
          out.domains = distinctLabels(rows.map((r) => r.domain), "بدون تصنيف");
        }),
    );
  }

  if (need.has("owner")) {
    jobs.push(
      db
        .selectDistinct({ owner: programs.ownerPosition })
        .from(programs)
        .where(isNull(programs.archivedAt))
        .then((rows) => {
          out.owners = distinctLabels(rows.map((r) => r.owner), "بدون مسؤول");
        }),
    );
  }

  if (need.has("committee")) {
    jobs.push(
      db
        .select({ id: committees.id, name: committees.nameAr, kind: committees.kind })
        .from(committees)
        .orderBy(asc(committees.nameAr))
        .then((rows) => {
          out.committees = rows.map((r) => ({
            value: r.id,
            label: orFallback(r.name, r.kind ? `${r.kind} بدون اسم` : "بدون اسم"),
          }));
        }),
    );
  }

  if (need.has("program")) {
    jobs.push(
      db
        .select({ id: programs.id, seq: programs.seq, name: programs.name })
        .from(programs)
        .where(isNull(programs.archivedAt))
        .orderBy(asc(programs.seq))
        .then((rows) => {
          out.programs = rows.map((r) => ({ value: r.id, label: `${r.seq}. ${orFallback(r.name, "بدون اسم")}` }));
        }),
    );
  }

  if (need.has("jobTitle")) {
    jobs.push(
      db
        .selectDistinct({ v: people.jobTitle })
        .from(people)
        .then((rows) => {
          out.jobTitles = distinctLabels(rows.map((r) => r.v), null);
        }),
    );
  }

  if (need.has("department")) {
    // «القسم» في سجل المنسوبين هو `org_unit` — الوحدة التنظيمية كما وردت من المصدر الرسمي
    jobs.push(
      db
        .selectDistinct({ v: people.orgUnit })
        .from(people)
        .then((rows) => {
          out.departments = distinctLabels(rows.map((r) => r.v), null);
        }),
    );
  }

  if (need.has("cycle")) {
    jobs.push(
      db
        .selectDistinct({ v: perfCycles.yearKey })
        .from(perfCycles)
        .then((rows) => {
          out.cycles = distinctLabels(rows.map((r) => r.v), null).map((v) => ({ value: v, label: v }));
        }),
    );
  }

  if (need.has("academicYear")) {
    jobs.push(
      db
        .select({ key: planYears.key })
        .from(planYears)
        .orderBy(asc(planYears.key))
        .then((rows) => {
          out.years = rows.map((r) => r.key);
        }),
    );
  }

  await Promise.all(jobs);
  return out;
}

/**
 * قيم متمايزة مرتّبة عربياً، مع تسمية صريحة للفراغ حين تكون له دلالة تشغيلية.
 * تمرير `null` لعلامة الفراغ يعني: أسقِط الفارغ بدل اختراع تصنيف له.
 */
function distinctLabels(values: (string | null)[], blankLabel: string | null): string[] {
  const set = new Set<string>();
  for (const v of values) {
    const trimmed = (v ?? "").trim();
    if (trimmed) set.add(trimmed);
    else if (blankLabel) set.add(blankLabel);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "ar"));
}

/**
 * جداول تحويل المعرّفات إلى أسماء — تُستعمل في شرائح الشاشة وفي ترويسة التقرير المُصدَّر
 * فيقرأ المدير «لجنة التوجيه والإرشاد» لا معرّفاً سداسياً عشرياً.
 */
export async function loadFilterLabelMaps(filters: {
  personIds?: string[];
  itemIds?: string[];
  committeeIds?: string[];
  programIds?: string[];
}): Promise<{
  people?: Map<string, string>;
  items?: Map<string, string>;
  committees?: Map<string, string>;
  programs?: Map<string, string>;
}> {
  const maps: Awaited<ReturnType<typeof loadFilterLabelMaps>> = {};
  const jobs: Promise<void>[] = [];

  if (filters.personIds?.length) {
    jobs.push(
      db
        .select({ id: people.id, name: people.fullName })
        .from(people)
        .where(sql`${people.id} = any(${filters.personIds})`)
        .then((rows) => {
          maps.people = new Map(rows.map((r) => [r.id, orFallback(r.name, "بدون اسم")]));
        }),
    );
  }
  if (filters.itemIds?.length) {
    jobs.push(
      db
        .select({ id: financialItems.id, name: financialItems.nameAr })
        .from(financialItems)
        .where(sql`${financialItems.id} = any(${filters.itemIds})`)
        .then((rows) => {
          maps.items = new Map(rows.map((r) => [r.id, orFallback(r.name, "بند بدون اسم")]));
        }),
    );
  }
  if (filters.committeeIds?.length) {
    jobs.push(
      db
        .select({ id: committees.id, name: committees.nameAr })
        .from(committees)
        .where(sql`${committees.id} = any(${filters.committeeIds})`)
        .then((rows) => {
          maps.committees = new Map(rows.map((r) => [r.id, orFallback(r.name, "بدون اسم")]));
        }),
    );
  }
  if (filters.programIds?.length) {
    jobs.push(
      db
        .select({ id: programs.id, seq: programs.seq, name: programs.name })
        .from(programs)
        .where(sql`${programs.id} = any(${filters.programIds})`)
        .then((rows) => {
          maps.programs = new Map(rows.map((r) => [r.id, `${r.seq}. ${orFallback(r.name, "بدون اسم")}`]));
        }),
    );
  }

  await Promise.all(jobs);
  return maps;
}

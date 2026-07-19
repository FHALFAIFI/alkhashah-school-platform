import "server-only";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  importBatches,
  people,
  users,
  programs,
  planYears,
  perfModels,
  floors,
  floorGeometryVersions,
} from "@/db/schema";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { peopleBatchDependencies, type PeopleDependency } from "@/lib/imports/people-dependencies";
import { getAiConfig } from "@/lib/ai/settings";
import { testConnection } from "@/lib/ai/provider";
import { feedbackSummaryCounts } from "@/lib/feedback/service";

export type PilotStatus = {
  fares: {
    batchId: string | null;
    committed: boolean;
    peopleFromBatch: number;
    teachers: number;
    staff: number;
    totalEmployees: number;
    loginUsers: number;
    employeeAccounts: number;
    rollbackDeps: PeopleDependency[];
    rollbackAvailable: boolean;
  };
  committeesReady: boolean;
  performanceReady: boolean;
  plan: { officialDraftPrograms: number; total: number };
  d014Pending: boolean;
  groundPublished: boolean;
  upperFloorsPending: string[];
  ai: { enabled: boolean; ok: boolean; local: boolean; model: string; detail: string };
  backup: { latestDaily: string | null; latestDailyAt: Date | null; latestWeekly: string | null; latestWeeklyAt: Date | null };
  feedback: { total: number; open: number; resolved: number; blocked: number };
};

function latestFile(dir: string): { name: string; at: Date } | null {
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".enc"));
    let best: { name: string; at: Date } | null = null;
    for (const f of files) {
      const at = statSync(path.join(dir, f)).mtime;
      if (!best || at > best.at) best = { name: f, at };
    }
    return best;
  } catch {
    return null;
  }
}

async function aiStatus(): Promise<PilotStatus["ai"]> {
  const config = await getAiConfig();
  if (!config.enabled) {
    return { enabled: false, ok: false, local: true, model: config.ollamaModel, detail: "المساعد الذكي غير مفعّل — المنصة تعمل بالكامل بدونه" };
  }
  try {
    const t = await testConnection(config);
    return { enabled: true, ok: t.ok, local: t.local, model: t.model, detail: t.detail };
  } catch {
    return { enabled: true, ok: false, local: true, model: config.ollamaModel, detail: "تعذّر الاتصال بالخدمة المحلية — المنصة تعمل بدونها" };
  }
}

/**
 * حالة التشغيل التجريبي محسوبة من الحالة الفعلية (قراءة فقط، لا كتابة).
 * تعمل في الحالتين: دفعة فارس في «معاينة» أو «منفذة».
 */
export async function getPilotStatus(): Promise<PilotStatus> {
  const excluded = await getExcludedIdSets();

  // دفعة فارس — أحدث دفعة أشخاص اسم ملفها يحوي «فارس» (بغض النظر عن الحالة)
  const [fares] = await db
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.importType, "people"), like(importBatches.sourceFileName, "%فارس%")))
    .orderBy(desc(importBatches.createdAt))
    .limit(1);

  const committed = fares?.status === "منفذة";
  const peopleFromBatch = fares
    ? (await db.select({ c: sql<number>`count(*)::int` }).from(people).where(eq(people.importBatchId, fares.id)))[0]?.c ?? 0
    : 0;

  // منسوبون معتمدون (نشطون وغير اصطناعيين) مصنّفون
  const emp = await db
    .select({ category: people.category })
    .from(people)
    .where(and(eq(people.active, true), notSynthetic(people.id, excluded.people)));
  const teachers = emp.filter((e) => e.category === "معلم").length;
  const staff = emp.filter((e) => e.category === "موظف").length;
  const totalEmployees = emp.length;

  const loginUsers = (await db.select({ c: sql<number>`count(*)::int` }).from(users))[0]?.c ?? 0;
  // حسابات دخول مرتبطة بأشخاص هذه الدفعة (يجب أن تبقى صفراً)
  let employeeAccounts = 0;
  if (fares) {
    const batchPeople = (await db.select({ id: people.id }).from(people).where(eq(people.importBatchId, fares.id))).map((p) => p.id);
    if (batchPeople.length > 0) {
      employeeAccounts =
        (await db.select({ c: sql<number>`count(*)::int` }).from(users).where(inArray(users.personId, batchPeople)))[0]?.c ?? 0;
    }
  }

  // تبعيات التراجع السبع (فارغة = كلها صفر = التراجع متاح)
  const preflight = committed && fares ? await peopleBatchDependencies(db, fares.id) : null;
  const rollbackDeps = preflight?.dependencies ?? [];
  const rollbackAvailable = committed ? !(preflight?.blocked ?? false) : false;

  const committeesReady = totalEmployees > 0;
  const performanceReady = totalEmployees > 0;

  // الخطة التشغيلية الرسمية — برامج «مسودة» غير اصطناعية
  const [activeYear] = await db.select().from(planYears).where(eq(planYears.status, "نشطة"));
  let officialDraftPrograms = 0;
  let planTotal = 0;
  if (activeYear) {
    const drafts = await db
      .select({ id: programs.id })
      .from(programs)
      .where(and(eq(programs.planYearId, activeYear.id), eq(programs.status, "مسودة"), notSynthetic(programs.id, excluded.programs)));
    officialDraftPrograms = drafts.length;
    const all = await db
      .select({ id: programs.id })
      .from(programs)
      .where(and(eq(programs.planYearId, activeYear.id), notSynthetic(programs.id, excluded.programs)));
    planTotal = all.length;
  }

  // D-014 — نموذج رسمي أصلي بخلية بانتظار المطابقة
  const [d014Model] = await db
    .select({ id: perfModels.id })
    .from(perfModels)
    .where(and(eq(perfModels.official, true), eq(perfModels.version, 1), inArray(perfModels.key, ["kindergarten-teacher", "school-vice", "school-principal"])))
    .limit(1);

  // الطوابق
  const groundFloor = (await db.select().from(floors).where(eq(floors.key, "ground")))[0];
  const groundPublished = groundFloor
    ? (await db
        .select({ id: floorGeometryVersions.id })
        .from(floorGeometryVersions)
        .where(and(eq(floorGeometryVersions.floorId, groundFloor.id), eq(floorGeometryVersions.status, "منشورة")))).length > 0
    : false;

  const upperFloors = await db.select().from(floors).where(inArray(floors.key, ["first", "second", "third"]));
  const upperIds = upperFloors.map((f) => f.id);
  const publishedUpper = upperIds.length
    ? await db
        .select({ floorId: floorGeometryVersions.floorId })
        .from(floorGeometryVersions)
        .where(and(inArray(floorGeometryVersions.floorId, upperIds), eq(floorGeometryVersions.status, "منشورة")))
    : [];
  const publishedSet = new Set(publishedUpper.map((r) => r.floorId));
  const upperFloorsPending = upperFloors.filter((f) => !publishedSet.has(f.id)).map((f) => f.nameAr);

  const backupDirRaw = process.env.BACKUP_DIR ?? "./backups";
  const backupDir = path.isAbsolute(backupDirRaw) ? backupDirRaw : path.resolve(process.cwd(), backupDirRaw);
  const daily = latestFile(path.join(backupDir, "daily"));
  const weekly = latestFile(path.join(backupDir, "weekly"));

  const [ai, feedback] = await Promise.all([aiStatus(), feedbackSummaryCounts()]);

  return {
    fares: {
      batchId: fares?.id ?? null,
      committed,
      peopleFromBatch,
      teachers,
      staff,
      totalEmployees,
      loginUsers,
      employeeAccounts,
      rollbackDeps,
      rollbackAvailable,
    },
    committeesReady,
    performanceReady,
    plan: { officialDraftPrograms, total: planTotal },
    d014Pending: !!d014Model,
    groundPublished,
    upperFloorsPending,
    ai,
    backup: {
      latestDaily: daily?.name ?? null,
      latestDailyAt: daily?.at ?? null,
      latestWeekly: weekly?.name ?? null,
      latestWeeklyAt: weekly?.at ?? null,
    },
    feedback,
  };
}

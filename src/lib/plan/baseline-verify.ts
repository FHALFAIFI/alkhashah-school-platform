import "server-only";
import { asc } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { programMilestones } from "@/db/schema";

/**
 * ضوابط مطابقة خط الأساس المعتمد (D-022).
 *
 * خط الأساس المعتمد = **129** معلماً في الإنتاج. تُتحقق من العدد وبصمة الصفوف المصدرية
 * مباشرةً قبل النسخ الاحتياطي وقبل الهجرة؛ أي تغيّر يوقف العملية بدل قبول عدد جديد بصمت.
 *
 * البصمة تُبنى من الحقول المستقرة لكل معلم بترتيب ثابت، فتكشف أي تعديل أو إضافة أو حذف
 * حتى لو بقي العدد نفسه.
 */

export const APPROVED_MILESTONE_BASELINE = 129;

export type BaselineFingerprint = {
  count: number;
  /** SHA-256 لكل صفوف المعالم بترتيب ثابت */
  fingerprint: string;
};

/** يبني بصمة مستقرة لكل المعالم — لا يكتب شيئاً. */
export async function captureMilestoneFingerprint(): Promise<BaselineFingerprint> {
  const rows = await db
    .select({
      id: programMilestones.id,
      programId: programMilestones.programId,
      weight: programMilestones.weight,
      status: programMilestones.status,
      progress: programMilestones.progress,
      sortOrder: programMilestones.sortOrder,
      title: programMilestones.title,
    })
    .from(programMilestones)
    .orderBy(asc(programMilestones.programId), asc(programMilestones.sortOrder), asc(programMilestones.id));

  const hash = createHash("sha256");
  for (const r of rows) {
    hash.update(`${r.id}|${r.programId}|${r.weight}|${r.status}|${r.progress}|${r.sortOrder}|${r.title}\n`);
  }
  return { count: rows.length, fingerprint: hash.digest("hex") };
}

export type BaselineCheck = {
  ok: boolean;
  count: number;
  expectedCount: number;
  fingerprint: string;
  /** حين تُمرَّر بصمة سابقة للمقارنة */
  fingerprintMatches?: boolean;
  messageAr: string;
};

/**
 * يتحقق من أن العدد يساوي 129 (أو أي خط أساس معتمد يُمرَّر)، واختيارياً أن البصمة لم تتغير.
 * يُستدعى قبل النسخ الاحتياطي وقبل الهجرة.
 */
export async function verifyBaseline(opts: { expectedCount?: number; expectedFingerprint?: string } = {}): Promise<BaselineCheck> {
  const expectedCount = opts.expectedCount ?? APPROVED_MILESTONE_BASELINE;
  const { count, fingerprint } = await captureMilestoneFingerprint();

  const countOk = count === expectedCount;
  const fingerprintMatches = opts.expectedFingerprint ? fingerprint === opts.expectedFingerprint : undefined;
  const ok = countOk && fingerprintMatches !== false;

  let messageAr: string;
  if (!countOk) {
    messageAr = `توقّف: عدد المعالم ${count} لا يساوي خط الأساس المعتمد ${expectedCount} — لا تتابع النسخ أو الهجرة.`;
  } else if (fingerprintMatches === false) {
    messageAr = "توقّف: بصمة صفوف المعالم تغيّرت منذ الالتقاط السابق — راجع قبل المتابعة.";
  } else {
    messageAr = `مطابق: ${count} معلماً = خط الأساس المعتمد${opts.expectedFingerprint ? " والبصمة ثابتة" : ""}.`;
  }

  return { ok, count, expectedCount, fingerprint, fingerprintMatches, messageAr };
}

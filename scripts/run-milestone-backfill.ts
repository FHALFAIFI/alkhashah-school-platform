/**
 * نقل المعالم إلى الأنشطة + المطابقة (D-020) — خطوة نشر واحدة مراجَعة.
 * للتشغيل بعد تطبيق هجرة 0011 وبعد التحقق من خط الأساس 129 (D-022).
 *
 *   NODE_OPTIONS=--conditions=react-server \
 *   DATABASE_URL=... npx tsx scripts/run-milestone-backfill.ts [expectedFingerprint]
 *
 * يخرج برمز 1 عند أي صف مطابقة فاشل أو عند تغيّر خط الأساس — فلا يتقدّم النشر بصمت.
 */
import { verifyBaseline } from "@/lib/plan/baseline-verify";
import { backfillMilestonesToActivities, reconcileMilestoneMigration } from "@/lib/plan/milestone-backfill";

async function main() {
  const expectedFingerprint = process.argv[2];

  // تحقق نهائي من خط الأساس قبل الكتابة
  const baseline = await verifyBaseline(expectedFingerprint ? { expectedFingerprint } : {});
  console.log(baseline.messageAr);
  if (!baseline.ok) {
    console.error("توقّف قبل النقل — خط الأساس لا يطابق.");
    process.exit(1);
  }

  const result = await backfillMilestonesToActivities();
  console.log(
    `النقل: خط الأساس ${result.legacyCount} · أُنشئ ${result.created} · كان منقولاً ${result.alreadyMigrated}` +
      (result.unmappedStatuses.length ? ` · حالات غير متوقعة: ${result.unmappedStatuses.join("، ")}` : ""),
  );

  const rec = await reconcileMilestoneMigration();
  for (const row of rec.rows) {
    console.log(`${row.passed ? "✓" : "✗"} ${row.checkAr} — متوقع ${row.expected}، فعلي ${row.actual}`);
  }
  if (!rec.passed) {
    console.error("فشلت المطابقة — راجع قبل المتابعة. لم تُمس المعالم القديمة.");
    process.exit(1);
  }
  console.log("✓ اكتملت المطابقة — كل معلم مُنقَل مرة واحدة بالضبط، والجدول القديم سليم.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

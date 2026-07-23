/**
 * تحقق من خط أساس المعالم المعتمد (D-022) — يُشغَّل قبل النسخ الاحتياطي وقبل الهجرة.
 * للقراءة فقط. لا يكتب في قاعدة البيانات إطلاقاً.
 *
 *   NODE_OPTIONS=--conditions=react-server \
 *   DATABASE_URL=... npx tsx scripts/verify-milestone-baseline.ts [expectedFingerprint]
 *
 * يخرج برمز 0 عند المطابقة و1 عند أي انحراف، فيصلح بوابةً في خطة النشر.
 */
import { verifyBaseline, captureMilestoneFingerprint } from "@/lib/plan/baseline-verify";

async function main() {
  const expectedFingerprint = process.argv[2];
  const snap = await captureMilestoneFingerprint();
  const check = await verifyBaseline(expectedFingerprint ? { expectedFingerprint } : {});

  console.log(`العدد: ${snap.count}`);
  console.log(`البصمة: ${snap.fingerprint}`);
  console.log(check.messageAr);

  if (!check.ok) {
    process.exitCode = 1;
    return;
  }
  // اطبع البصمة لالتقاطها قبل الهجرة ومقارنتها لاحقاً
  if (!expectedFingerprint) {
    console.log(`\nمرِّر هذه البصمة عند التحقق الثاني قبل الهجرة:\n${snap.fingerprint}`);
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);

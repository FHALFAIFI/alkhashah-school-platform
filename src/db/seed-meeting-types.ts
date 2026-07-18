/**
 * بذرة أنواع الاجتماعات الافتراضية — idempotent (onConflictDoNothing على key).
 * تُشغَّل على madrasa_test وقاعدة التطوير؛ لا تلمس أي بيانات نطاق قائمة (جدول جديد فقط).
 */
import { db, pool } from "./index";
import { meetingTypes } from "./schema";
import { DEFAULT_MEETING_TYPES } from "./seed-data/meeting-types";

async function main() {
  for (const t of DEFAULT_MEETING_TYPES) {
    await db.insert(meetingTypes).values(t).onConflictDoNothing({ target: meetingTypes.key });
  }
  const rows = await db.select().from(meetingTypes);
  console.log(`أنواع الاجتماعات: ${rows.length}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

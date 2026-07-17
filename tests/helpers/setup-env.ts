// يضبط بيئة الاختبار قبل استيراد أي وحدة — قاعدة اختبار معزولة وتخزين مؤقت.
// MADRASA_ENV=test يفعّل حارس الأمان في طبقة الاتصال (fail-closed):
// لن يُفتح أي اتصال إلا على قاعدة اسمها ينتهي بـ _test.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertTestDatabase } from "../../src/db/guard";

process.env.MADRASA_ENV = "test";
process.env.DATABASE_URL = "postgresql://madrasa:madrasa_dev@localhost:5544/madrasa_test";
process.env.STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "madrasa-test-storage-"));
process.env.SESSION_SECRET = "test-secret";

// تحقق صريح قبل أي استيراد لطبقة القاعدة — يوقف الحزمة كلها لو أشار الرابط لقاعدة حقيقية
assertTestDatabase(process.env.DATABASE_URL);

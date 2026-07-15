// يضبط بيئة الاختبار قبل استيراد أي وحدة — قاعدة اختبار معزولة وتخزين مؤقت
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DATABASE_URL = "postgresql://madrasa:madrasa_dev@localhost:5544/madrasa_test";
process.env.STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "madrasa-test-storage-"));
process.env.SESSION_SECRET = "test-secret";

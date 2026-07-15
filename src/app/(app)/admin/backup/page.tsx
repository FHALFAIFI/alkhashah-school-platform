import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card } from "@/components/ui";
import { getSetting } from "@/lib/settings";

export const metadata = { title: "النسخ الاحتياطي" };
export const dynamic = "force-dynamic";

export default async function BackupPage() {
  await requirePermission("admin.backup");
  const [dailyRet, weeklyRet] = await Promise.all([
    getSetting("backup.daily_retention", 14),
    getSetting("backup.weekly_retention", 8),
  ]);

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="النسخ الاحتياطي" subtitle="النسخ مشفرة دائماً، وتحفظ نسخة خارج الجهاز المضيف" />
      <Card>
        <h2 className="mb-2 font-bold text-gray-800">السياسة الحالية</h2>
        <ul className="list-inside list-disc space-y-1 text-sm text-gray-600">
          <li>نسخة يومية لقاعدة البيانات — الاحتفاظ بآخر {dailyRet} نسخة</li>
          <li>نسخة أسبوعية كاملة مشفرة (قاعدة البيانات + المرفقات + الإعدادات) — الاحتفاظ بآخر {weeklyRet} نسخ</li>
          <li>التشفير عبر مفتاح في ملف البيئة على الخادم — لا يحفظ المفتاح داخل النسخة</li>
          <li>بروفة استعادة حقيقية مطلوبة قبل الإطلاق وتوثق نتيجتها</li>
        </ul>
        <p className="mt-3 rounded-lg bg-sand-100 p-3 text-xs text-gray-600">
          تشغيل النسخ من سطر الأوامر على الخادم: <code dir="ltr">npm run backup:daily</code> و<code dir="ltr">npm run backup:weekly</code> — والجدولة عبر مجدول النظام. التفاصيل في دليل التشغيل.
        </p>
      </Card>
    </div>
  );
}

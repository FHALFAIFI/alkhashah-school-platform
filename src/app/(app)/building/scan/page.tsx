import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card } from "@/components/ui";
import { QrScanner } from "./qr-scanner";

export const metadata = { title: "مسح رمز QR" };
export const dynamic = "force-dynamic";

export default async function ScanPage() {
  await requirePermission("building.read");
  return (
    <div className="space-y-5">
      <PageHeader
        title="مسح رمز QR للغرف والأصول"
        subtitle="امسح رمز غرفة أو أصل لفتح سجله وبدء فحص أو بلاغ صيانة — أو أدخل الرمز يدوياً. المسح قراءة فقط ولا يُنشئ أي سجل تلقائياً."
      />
      <Card>
        <QrScanner />
      </Card>
      <p className="text-xs text-gray-400">
        <Link prefetch={false} href="/building" className="underline">← وحدة المبنى</Link>
      </p>
    </div>
  );
}

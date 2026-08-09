import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { getFeedbackById } from "@/lib/feedback/service";
import { isSafeInternalPath } from "@/lib/feedback/constants";
import { PageHeader, Card, Badge } from "@/components/ui";
import { orFallback } from "@/lib/format";
import { FeedbackWorkflow } from "./workflow";

export const dynamic = "force-dynamic";

export default async function FeedbackDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("feedback.manage");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const row = await getFeedbackById(id);
  if (!row) notFound();
  const f = row.f;

  const fmt = (d: Date | null) =>
    d
      ? new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", { dateStyle: "long" }).format(d) +
        " · " +
        new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "short" }).format(d)
      : "—";

  const linkedOpenable = isSafeInternalPath(f.pagePath);

  return (
    <div>
      <PageHeader
        title={`ملاحظة ${f.ref}`}
        subtitle={orFallback(f.title)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge value={f.status} />
            {f.archivedAt && <Badge value="مؤرشف" />}
            <Link prefetch={false} href="/admin/feedback" className="rounded-lg border border-sand-200 px-3 py-1.5 text-sm hover:bg-sand-100">
              عودة للقائمة
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* التفاصيل */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Item label="الفئة"><Badge value={f.category} /></Item>
              <Item label="الأهمية"><Badge value={f.severity} /></Item>
              <Item label="الوحدة">{f.module}</Item>
              <Item label="يعيق العمل">{f.blocked ? "نعم" : "لا"}</Item>
            </dl>
            <div className="mt-4 space-y-3 border-t border-sand-100 pt-4 text-sm">
              <Para label="ما الذي كان يحاول عمله" value={f.attempted} />
              <Para label="ما الذي حدث" value={f.happened} />
              <Para label="ما الذي كان متوقعاً" value={f.expected} />
            </div>
          </Card>

          {row.attachmentName && (
            <Card>
              <h2 className="mb-2 font-bold text-brand-900">المرفق</h2>
              <a
                href={`/api/feedback/${f.id}/attachment`}
                className="inline-flex items-center gap-2 rounded-lg border border-sand-200 px-3 py-2 text-sm text-brand-700 hover:bg-sand-100"
              >
                <span aria-hidden>📎</span>
                <span className="break-all">{row.attachmentName}</span>
                <span className="text-xs text-gray-400">({Math.ceil((row.attachmentSize ?? 0) / 1024)} ك.ب)</span>
              </a>
            </Card>
          )}

          {(f.reviewNote || f.resolutionNote) && (
            <Card>
              <h2 className="mb-2 font-bold text-brand-900">المعالجة والاستجابة</h2>
              <dl className="space-y-3 text-sm">
                <Para label="ملاحظة المراجعة الداخلية" value={f.reviewNote} />
                <Para label="ملاحظة الحل" value={f.resolutionNote} />
                {f.resolvedAt && <Item label="تاريخ الحل/القرار">{fmt(f.resolvedAt)}</Item>}
              </dl>
            </Card>
          )}
        </div>

        {/* البيانات الملتقطة + المعالجة */}
        <div className="space-y-4">
          <Card>
            <h2 className="mb-3 font-bold text-brand-900">البيانات الملتقطة</h2>
            <p className="mb-3 rounded-lg bg-sand-50 p-2 text-xs text-gray-500">
              بيانات آمنة فقط — لا محتوى شاشة ولا كوكيز ولا رموز ولا بيانات منسوبين.
            </p>
            <dl className="space-y-2 text-sm">
              <Item label="الصفحة">
                {linkedOpenable ? (
                  <Link prefetch={false} href={f.pagePath} className="text-brand-700 underline-offset-2 hover:underline" dir="ltr">
                    {f.pagePath}
                  </Link>
                ) : (
                  <span dir="ltr" className="text-gray-500">{f.pagePath}</span>
                )}
              </Item>
              <Item label="نوع الجهاز">{f.deviceClass ?? "—"}</Item>
              <Item label="مقاس الشاشة"><span dir="ltr">{f.viewport ?? "—"}</span></Item>
              <Item label="المتصفح">{f.browser ?? "—"}</Item>
              <Item label="نسخة التطبيق"><span dir="ltr">{f.appVersion ?? "—"}</span></Item>
              <Item label="المُرسِل">{row.createdByName ?? "—"}</Item>
              <Item label="تاريخ الإرسال">{fmt(f.createdAt)}</Item>
            </dl>
          </Card>

          <FeedbackWorkflow id={f.id} status={f.status} archived={!!f.archivedAt} />
          <p className="text-xs text-gray-400">تُسجَّل كل التغييرات في سجل التدقيق. لا يوجد حذف نهائي — الأرشفة فقط.</p>
        </div>
      </div>
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function Para({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap break-words">{value || "—"}</dd>
    </div>
  );
}

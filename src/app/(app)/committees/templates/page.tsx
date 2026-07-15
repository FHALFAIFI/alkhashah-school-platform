import { asc } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { committeeTemplates } from "@/db/schema";
import { PageHeader, Card, Badge } from "@/components/ui";

export const metadata = { title: "قوالب اللجان" };
export const dynamic = "force-dynamic";

const RECURRENCE_LABELS: Record<string, string> = {
  weekly: "أسبوعي",
  monthly: "شهري",
  term: "فصلي",
  on_demand: "عند الحاجة",
  none: "بدون تكرار",
};

export default async function TemplatesPage() {
  await requirePermission("committees.read");
  const templates = await db.select().from(committeeTemplates).orderBy(asc(committeeTemplates.createdAt));

  return (
    <div>
      <PageHeader
        title="قوالب اللجان والفرق"
        subtitle="منقولة من قرار تشكيل اللجان 1447 — يعاد التشكيل سنوياً من القوالب دون نسخ عضويات الأعوام السابقة"
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {templates.map((t) => (
          <Card key={t.id}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-bold text-brand-900">{t.nameAr}</h2>
              <div className="flex gap-2">
                <Badge value={t.kind} />
                <span className="rounded-full bg-sand-100 px-2 py-0.5 text-xs">{RECURRENCE_LABELS[t.recurrence] ?? t.recurrence}</span>
              </div>
            </div>
            {t.goal && <p className="mb-2 text-sm text-gray-600">{t.goal}</p>}
            <details className="mb-2">
              <summary className="cursor-pointer text-sm font-medium text-brand-700">
                المهام ({(t.duties ?? []).length})
              </summary>
              <ol className="mt-2 list-inside list-decimal space-y-1 text-xs text-gray-600">
                {(t.duties ?? []).map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ol>
            </details>
            <details>
              <summary className="cursor-pointer text-sm font-medium text-brand-700">
                المقاعد ({(t.seats ?? []).length})
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-gray-600">
                {(t.seats ?? []).map((s, i) => (
                  <li key={i}>
                    {s.position} — <span className="font-medium">{s.role}</span>
                  </li>
                ))}
              </ul>
            </details>
            {t.recurrenceNote && <p className="mt-2 text-xs text-gray-400">{t.recurrenceNote}</p>}
          </Card>
        ))}
      </div>
    </div>
  );
}

import { and, desc, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { evidenceItems, evidenceLinks } from "@/db/schema";
import { PageHeader, Table, Badge, EmptyState, LinkButton } from "@/components/ui";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { EvidenceReviewControl } from "./review-ui";
import { SectionReportsLink } from "@/components/section-reports-link";

export const metadata = { title: "الشواهد" };
export const dynamic = "force-dynamic";

export default async function EvidencePage({ searchParams }: { searchParams: Promise<{ عرض?: string }> }) {
  const user = await requirePermission("evidence.read");
  const canReview = user.permissions.has("evidence.write");
  const params = await searchParams;
  // الافتراضي: النشط فقط. الأرشفة إخفاء غير مدمّر — والمؤرشف يبقى قابلاً للعرض والاستعادة.
  const showArchived = params["عرض"] === "المؤرشفة";

  const excluded = await getExcludedIdSets();
  const items = await db
    .select()
    .from(evidenceItems)
    .where(
      and(
        notSynthetic(evidenceItems.id, excluded.evidence),
        showArchived ? isNotNull(evidenceItems.archivedAt) : isNull(evidenceItems.archivedAt),
      ),
    )
    .orderBy(desc(evidenceItems.createdAt));
  // Count links per evidence item in SQL (GROUP BY) rather than loading the whole
  // evidence_links table and counting in JS. Scoped to the items actually shown.
  const itemIds = items.map((i) => i.id);
  const linkCount = new Map<string, number>();
  if (itemIds.length > 0) {
    const counts = await db
      .select({ evidenceId: evidenceLinks.evidenceId, n: sql<number>`count(*)` })
      .from(evidenceLinks)
      .where(inArray(evidenceLinks.evidenceId, itemIds))
      .groupBy(evidenceLinks.evidenceId);
    for (const c of counts) linkCount.set(c.evidenceId, Number(c.n));
  }

  return (
    <div>
      <PageHeader
        title="سجل الشواهد الموحد"
        subtitle="يُرفع الشاهد مرة واحدة ويُربط بعدة سجلات عبر جميع الوحدات — الاستبدال يحفظ النسخة السابقة، والحذف النهائي متاح فقط لشاهد غير مرتبط بأي سجل"
      actions={<SectionReportsLink category="evidence" />}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <LinkButton href="/evidence" variant={!showArchived ? "primary" : "secondary"}>الشواهد النشطة</LinkButton>
        <LinkButton href="/evidence?عرض=المؤرشفة" variant={showArchived ? "primary" : "secondary"}>المؤرشفة</LinkButton>
      </div>
      {items.length === 0 ? (
        <EmptyState
          title={showArchived ? "لا شواهد مؤرشفة" : "لا شواهد بعد"}
          hint={
            showArchived
              ? "الشواهد المؤرشفة مخفية من الوحدات مع بقاء روابطها وبياناتها كاملة"
              : "تضاف الشواهد من داخل البرامج والاجتماعات وجلسات الأداء واللجان والغرف والأصول، أو من هنا"
          }
        />
      ) : (
        <Table headers={["العنوان", "النوع", "الدور", "المصدر", "النسخة", "حالة المراجعة", "مستخدم في", "تنزيل", ""]}>
          {items.map((item) => (
            <tr key={item.id} id={`ev-${item.id}`}>
              <td className="px-3 py-2 font-medium">{item.title}</td>
              <td className="px-3 py-2 text-xs">{item.kind === "file" ? "ملف" : item.kind === "link" ? "رابط" : "نص"}</td>
              <td className="px-3 py-2">{item.role ? <Badge value={item.role} /> : "—"}</td>
              <td className="px-3 py-2 text-xs">{item.source ?? "—"}</td>
              <td className="px-3 py-2 tabular-nums text-xs">{item.version}</td>
              <td className="px-3 py-2 text-xs">
                <div className="space-y-1">
                  <Badge value={item.reviewStatus} />
                  {item.reviewNote && <p className="text-xs text-gray-400">{item.reviewNote}</p>}
                  {canReview && item.reviewStatus === "لم يراجع" && <EvidenceReviewControl evidenceId={item.id} />}
                </div>
              </td>
              <td className="px-3 py-2 tabular-nums">{linkCount.get(item.id) ?? 0}</td>
              <td className="px-3 py-2">
                {item.fileId ? (
                  <a href={`/api/files/${item.fileId}`} className="text-xs text-brand-700 underline">تنزيل</a>
                ) : item.url ? (
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-700 underline">فتح الرابط</a>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-2">
                <LinkButton href={`/evidence/${item.id}`} variant="secondary">عرض</LinkButton>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

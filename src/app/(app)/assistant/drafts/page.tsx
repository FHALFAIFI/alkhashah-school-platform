import { desc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { aiDrafts } from "@/db/schema";
import { PageHeader, Card, Badge, EmptyState, LinkButton } from "@/components/ui";
import { DeleteDraftButton } from "./draft-actions-ui";

export const metadata = { title: "مسودات المساعد" };
export const dynamic = "force-dynamic";

export default async function DraftsPage() {
  const user = await requirePermission("ai.use");
  const drafts = await db.select().from(aiDrafts).where(eq(aiDrafts.userId, user.id)).orderBy(desc(aiDrafts.createdAt)).limit(100);

  return (
    <div>
      <PageHeader
        title="مسودات المساعد"
        subtitle="نصوص مقترحة تراجعها وتنقلها بنفسك إلى السجلات الرسمية — المساعد لا يمس السجل الرسمي"
        actions={<LinkButton href="/assistant" variant="secondary">عودة للمساعد</LinkButton>}
      />
      {drafts.length === 0 ? (
        <EmptyState title="لا مسودات بعد" hint="اطلب من المساعد إنشاء مسودة (محضر، جدول أعمال، تقرير…) وستظهر هنا بعد تأكيدك" />
      ) : (
        <div className="space-y-3">
          {drafts.map((d) => (
            <Card key={d.id} className="scroll-mt-20" >
              <div id={d.id} className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="font-bold text-brand-900">{d.title}</h2>
                  <p className="mt-0.5 text-xs text-gray-400 tabular-nums">
                    {d.createdAt.toLocaleString("ar-SA-u-nu-latn", { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge value={d.kind} />
                  <DeleteDraftButton draftId={d.id} />
                </div>
              </div>
              <pre className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-sand-50 p-3 font-sans text-sm leading-relaxed">
                {d.content}
              </pre>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

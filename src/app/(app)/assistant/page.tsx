import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { getAiConfig, providerNameAr } from "@/lib/ai/settings";
import { db } from "@/db";
import { aiConversations, aiDrafts } from "@/db/schema";
import { PageHeader, Card, LinkButton } from "@/components/ui";
import { AssistantChat } from "@/components/assistant/assistant-chat";
import { ConversationList } from "./conversation-list";

export const metadata = { title: "مساعد المدير الذكي" };
export const dynamic = "force-dynamic";

export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ نوع?: string; معرف?: string; تسمية?: string; محادثة?: string }>;
}) {
  const user = await requirePermission("ai.use");
  const params = await searchParams;
  const config = await getAiConfig();

  const context =
    params["نوع"] && params["معرف"]
      ? { type: params["نوع"], id: params["معرف"], label: params["تسمية"] ?? params["نوع"] }
      : null;

  if (!config.enabled) {
    return (
      <div>
        <PageHeader title="مساعد المدير الذكي" subtitle="مساعد عربي يعمل محلياً — يجيب عن السجلات وينشئ مسودات، والقرار دائماً بيدك" />
        <Card className="mx-auto max-w-lg text-center">
          <div className="text-3xl" aria-hidden>✦</div>
          <p className="mt-2 font-bold text-brand-900">المساعد معطل حالياً</p>
          <p className="mt-1 text-sm text-gray-500">
            المنصة تعمل كاملة بدونه. يمكن لمن يملك صلاحية الإدارة تفعيله والتحقق من الاتصال بالمزود المحلي من صفحة الإعدادات.
          </p>
          {user.permissions.has("ai.manage") && (
            <div className="mt-4">
              <LinkButton href="/admin/settings/ai">فتح إعدادات الذكاء الاصطناعي</LinkButton>
            </div>
          )}
        </Card>
      </div>
    );
  }

  const conversations = await db
    .select()
    .from(aiConversations)
    .where(eq(aiConversations.userId, user.id))
    .orderBy(desc(aiConversations.lastMessageAt))
    .limit(20);

  const [draftCountRow] = await db
    .select({ id: aiDrafts.id })
    .from(aiDrafts)
    .where(eq(aiDrafts.userId, user.id))
    .limit(1);

  const activeConversation = params["محادثة"] && conversations.some((c) => c.id === params["محادثة"]) ? params["محادثة"] : null;

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col">
      <PageHeader
        title="مساعد المدير الذكي"
        subtitle={`المزود: ${providerNameAr(config.provider)} — كل إجراء كتابي يتطلب تأكيدك`}
        actions={
          <div className="flex flex-wrap gap-2">
            {draftCountRow && <LinkButton href="/assistant/drafts" variant="secondary">المسودات</LinkButton>}
            {user.permissions.has("ai.manage") && <LinkButton href="/admin/settings/ai" variant="secondary">الإعدادات</LinkButton>}
          </div>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-4">
        <div className="hidden lg:block">
          <ConversationList
            conversations={conversations.map((c) => ({ id: c.id, title: c.title }))}
            active={activeConversation}
            csrfToken={user.csrfToken}
          />
        </div>
        <Card className="flex min-h-[60vh] flex-col !p-0 lg:col-span-3">
          <AssistantChat
            key={activeConversation ?? "new"}
            csrfToken={user.csrfToken}
            context={context}
            initialConversationId={activeConversation}
          />
        </Card>
      </div>

      {conversations.length > 0 && (
        <div className="mt-3 lg:hidden">
          <ConversationList
            conversations={conversations.map((c) => ({ id: c.id, title: c.title }))}
            active={activeConversation}
            csrfToken={user.csrfToken}
          />
        </div>
      )}

      <p className="mt-3 text-center text-xs text-gray-400">
        المساعد لا يعتمد ولا يوقع ولا يقيم ولا يرسل ولا يحذف — تلك أعمال يدوية للمدير حصراً. كل استخدام مسجل في{" "}
        <Link href="/admin/audit" className="underline">سجل التدقيق</Link>.
      </p>
    </div>
  );
}

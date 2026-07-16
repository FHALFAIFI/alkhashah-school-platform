import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import { AssistantDock } from "@/components/assistant/assistant-dock";
import { getAiConfig } from "@/lib/ai/settings";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [unread, aiConfig] = await Promise.all([
    db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt))),
    getAiConfig(),
  ]);

  const showAssistant = aiConfig.enabled && user.permissions.has("ai.use");

  return (
    <AppShell
      displayName={user.displayName}
      permissions={[...user.permissions]}
      unreadCount={unread.length}
    >
      {children}
      {showAssistant && <AssistantDock csrfToken={user.csrfToken} />}
    </AppShell>
  );
}

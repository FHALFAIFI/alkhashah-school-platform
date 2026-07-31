import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import { PwaManager } from "@/components/pwa-manager";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const unread = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));

  return (
    <AppShell
      displayName={user.displayName}
      permissions={[...user.permissions]}
      unreadCount={unread.length}
    >
      {children}
      {/* «إرسال ملاحظة» انتقل إلى الشريط العلوي داخل AppShell (v2.3 §19) */}
      <PwaManager />
    </AppShell>
  );
}

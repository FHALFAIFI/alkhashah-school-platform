import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import { releaseLabel } from "@/lib/release";
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
      releaseLabel={releaseLabel()}
    >
      {/*
       * D-069: ختم تصييرٍ يتغير مع كل تصيير من الخادم. تحديث الصفحة بعد إجراء الخادم
       * (D-053) ثبت أنه قد يضيع على HTTP/1.1 في بناء الإنتاج — يُجهَض تدفّقه قبل تطبيقه —
       * فتتحقق خطاطيف `useRefresh*` من تغيّر هذا الختم بعد كل تحديث وتعيد المحاولة محدوداً
       * إن لم يتغير. انظر `components/form-reset.ts`.
       */}
      <div hidden data-render-stamp={randomUUID()} />
      {children}
      {/* «إرسال ملاحظة» انتقل إلى الشريط العلوي داخل AppShell (v2.3 §19) */}
      <PwaManager />
    </AppShell>
  );
}

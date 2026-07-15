import Link from "next/link";
import { desc, eq, and, isNull } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { PageHeader, EmptyState, SubmitButton } from "@/components/ui";
import { revalidatePath } from "next/cache";

export const metadata = { title: "الإشعارات" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await requireUser();
  const items = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, user.id))
    .orderBy(desc(notifications.createdAt))
    .limit(100);

  async function markAllRead() {
    "use server";
    const u = await requireUser();
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, u.id), isNull(notifications.readAt)));
    revalidatePath("/notifications");
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="الإشعارات"
        actions={
          <form action={markAllRead}>
            <SubmitButton variant="secondary">تعليم الكل كمقروء</SubmitButton>
          </form>
        }
      />
      {items.length === 0 ? (
        <EmptyState title="لا إشعارات" />
      ) : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li
              key={n.id}
              className={`rounded-xl border p-3 ${n.readAt ? "border-sand-200 bg-white" : "border-brand-200 bg-brand-50"}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{n.title}</span>
                <span className="text-xs text-gray-400 tabular-nums">
                  {n.createdAt.toLocaleString("ar-SA-u-nu-latn", { dateStyle: "short", timeStyle: "short" })}
                </span>
              </div>
              {n.body && <p className="mt-1 text-sm text-gray-600">{n.body}</p>}
              {n.link && (
                <Link href={n.link} className="mt-1 inline-block text-xs text-brand-700 underline">
                  فتح
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

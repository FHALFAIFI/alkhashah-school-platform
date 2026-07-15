import "server-only";
import { db } from "@/db";
import { notifications, users } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function notifyUser(userId: string, n: { title: string; body?: string; link?: string; kind?: string }) {
  await db.insert(notifications).values({ userId, ...n });
}

/** إشعار جميع المستخدمين النشطين (المدير ومسؤول النظام حالياً) */
export async function notifyAll(n: { title: string; body?: string; link?: string; kind?: string }) {
  const active = await db.select({ id: users.id }).from(users).where(eq(users.active, true));
  for (const u of active) await notifyUser(u.id, n);
}

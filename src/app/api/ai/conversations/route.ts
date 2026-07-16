import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { aiConversations } from "@/db/schema";
import { getCurrentUser, requireCsrf, AuthError } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !user.permissions.has("ai.use")) return NextResponse.json({ conversations: [] }, { status: user ? 403 : 401 });
  const rows = await db
    .select()
    .from(aiConversations)
    .where(eq(aiConversations.userId, user.id))
    .orderBy(desc(aiConversations.lastMessageAt))
    .limit(30);
  return NextResponse.json({ conversations: rows.map((c) => ({ id: c.id, title: c.title, lastMessageAt: c.lastMessageAt })) });
}

/** حذف كل محادثات المستخدم الحالي */
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !user.permissions.has("ai.use")) return NextResponse.json({ ok: false }, { status: user ? 403 : 401 });
  try {
    await requireCsrf(user);
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof AuthError ? e.message : "" }, { status: 403 });
  }
  await db.delete(aiConversations).where(eq(aiConversations.userId, user.id));
  await audit({ actorId: user.id, action: "ai.history_deleted", summary: "حذف سجل محادثات المساعد بالكامل" });
  return NextResponse.json({ ok: true });
}

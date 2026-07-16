import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { aiConversations, aiMessages } from "@/db/schema";
import { getCurrentUser, requireCsrf, AuthError } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !user.permissions.has("ai.use")) return NextResponse.json({ messages: [] }, { status: user ? 403 : 401 });
  const { id } = await params;
  const [conv] = await db.select().from(aiConversations).where(and(eq(aiConversations.id, id), eq(aiConversations.userId, user.id)));
  if (!conv) return NextResponse.json({ messages: [] }, { status: 404 });
  const rows = await db.select().from(aiMessages).where(eq(aiMessages.conversationId, id)).orderBy(asc(aiMessages.createdAt)).limit(200);
  return NextResponse.json({
    id: conv.id,
    title: conv.title,
    messages: rows
      .filter((m) => m.role !== "tool")
      .map((m) => ({ id: m.id, role: m.role, content: m.content, provider: m.provider, local: m.local, sources: m.sources ?? [] })),
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !user.permissions.has("ai.use")) return NextResponse.json({ ok: false }, { status: user ? 403 : 401 });
  try {
    await requireCsrf(user);
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof AuthError ? e.message : "" }, { status: 403 });
  }
  const { id } = await params;
  const deleted = await db
    .delete(aiConversations)
    .where(and(eq(aiConversations.id, id), eq(aiConversations.userId, user.id)))
    .returning();
  if (deleted.length > 0) {
    await audit({ actorId: user.id, action: "ai.conversation_deleted", entityType: "ai_conversation", entityId: id, summary: "حذف محادثة مساعد" });
  }
  return NextResponse.json({ ok: deleted.length > 0 });
}

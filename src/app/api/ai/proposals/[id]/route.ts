import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, requireCsrf, AuthError } from "@/lib/auth/session";
import { confirmProposal, cancelProposal } from "@/lib/ai/orchestrator";

export const dynamic = "force-dynamic";

async function authed(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("غير مصادق", 401);
  if (!user.permissions.has("ai.use")) throw new AuthError("لا تملك صلاحية استخدام المساعد", 403);
  await requireCsrf(user);
  return user;
}

/** تأكيد تنفيذ مقترح — التنفيذ يحدث مرة واحدة فقط مهما تكرر الطلب */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authed(req);
    const { id } = await params;
    const result = await confirmProposal(user, id);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ ok: false, message: e.message }, { status: e.status });
    return NextResponse.json({ ok: false, message: "خطأ غير متوقع" }, { status: 500 });
  }
}

/** إلغاء مقترح */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authed(req);
    const { id } = await params;
    const result = await cancelProposal(user, id);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ ok: false, message: e.message }, { status: e.status });
    return NextResponse.json({ ok: false, message: "خطأ غير متوقع" }, { status: 500 });
  }
}

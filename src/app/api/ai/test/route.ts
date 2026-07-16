import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, requireCsrf, AuthError } from "@/lib/auth/session";
import { getAiConfig } from "@/lib/ai/settings";
import { testConnection } from "@/lib/ai/provider";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** فحص اتصال مزود الذكاء الاصطناعي بالإعدادات المحفوظة — للمشرفين */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, detail: "غير مصادق" }, { status: 401 });
  if (!user.permissions.has("ai.manage")) return NextResponse.json({ ok: false, detail: "لا تملك صلاحية إدارة الذكاء الاصطناعي" }, { status: 403 });
  try {
    await requireCsrf(user);
  } catch (e) {
    return NextResponse.json({ ok: false, detail: e instanceof AuthError ? e.message : "" }, { status: 403 });
  }
  const config = await getAiConfig();
  const result = await testConnection(config);
  await audit({ actorId: user.id, action: "ai.connection_tested", summary: `فحص اتصال ${result.nameAr}: ${result.ok ? "ناجح" : "فاشل"}`, detail: { detail: result.detail, latencyMs: result.latencyMs } });
  return NextResponse.json(result);
}

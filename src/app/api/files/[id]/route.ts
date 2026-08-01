import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, AuthError } from "@/lib/auth/session";
import { readStoredFile } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";

/**
 * تنزيل المرفقات — مصادقة وتفويض ومسارات آمنة (المعرف UUID فقط، لا مسارات من العميل)
 * والاسم الأصلي يعاد في الترويسة.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
  if (!user.permissions.has("files.download")) {
    return NextResponse.json({ error: "لا تملك صلاحية التنزيل" }, { status: 403 });
  }
  if (!rateLimit(`download:${user.id}`, 120)) {
    return NextResponse.json({ error: "معدل تنزيل مرتفع — انتظر قليلاً" }, { status: 429 });
  }

  const { id } = await ctx.params;
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return NextResponse.json({ error: "معرف غير صالح" }, { status: 400 });

  let result;
  try {
    result = await readStoredFile(parsed.data);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "تعذر قراءة الملف" }, { status: 500 });
  }
  if (!result) return NextResponse.json({ error: "الملف غير موجود" }, { status: 404 });

  const { file, data } = result;

  // v2.4 §16 (D-013): ملف PDF لوثيقة أداء فردية لا يُنزَّل إلا بصلاحية الأداء الفردي —
  // كان تقرير الجلسة الموقع متاحاً لكل حامل files.download رغم حساسيته
  if (file.mime === "application/pdf") {
    const { db } = await import("@/db");
    const { documents } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { PERFORMANCE_SENSITIVE_DOC_TYPES } = await import("@/lib/templates/schema");
    const [doc] = await db
      .select({ docType: documents.docType })
      .from(documents)
      .where(eq(documents.pdfFileId, file.id));
    if (
      doc &&
      (PERFORMANCE_SENSITIVE_DOC_TYPES as readonly string[]).includes(doc.docType) &&
      !user.permissions.has("performance.individual.read")
    ) {
      return NextResponse.json({ error: "وثيقة أداء فردية — تتطلب صلاحية الاطلاع على الأداء الفردي" }, { status: 403 });
    }
  }

  // الملفات الحساسة (التوقيع/الختم) تتطلب صلاحية إضافية وتدقق
  if (file.sensitive) {
    if (!user.permissions.has("branding.use") && !user.permissions.has("admin.settings")) {
      return NextResponse.json({ error: "الملف مقيد" }, { status: 403 });
    }
    await audit({
      actorId: user.id,
      action: "file.sensitive_download",
      entityType: "stored_file",
      entityId: file.id,
      summary: `تنزيل ملف حساس: ${file.originalName}`,
    });
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": file.mime,
      "Content-Length": String(file.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

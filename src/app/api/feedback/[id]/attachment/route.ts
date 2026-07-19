import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { feedback } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { readStoredFile } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";

/**
 * تنزيل مرفق ملاحظة — مقيّد بصلاحية إدارة الملاحظات (feedback.manage). المرفقات ملفات
 * حساسة خاصة؛ المعرف المستخدم هو معرّف الملاحظة (لا مسارات من العميل) والتنزيل مدقَّق.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
  if (!user.permissions.has("feedback.manage")) {
    return NextResponse.json({ error: "لا تملك صلاحية عرض مرفقات الملاحظات" }, { status: 403 });
  }
  if (!rateLimit(`feedback-attach:${user.id}`, 120)) {
    return NextResponse.json({ error: "معدل تنزيل مرتفع — انتظر قليلاً" }, { status: 429 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "معرف غير صالح" }, { status: 400 });
  }

  const [row] = await db.select().from(feedback).where(eq(feedback.id, id));
  if (!row || !row.attachmentFileId) {
    return NextResponse.json({ error: "لا يوجد مرفق" }, { status: 404 });
  }

  const result = await readStoredFile(row.attachmentFileId);
  if (!result) return NextResponse.json({ error: "الملف غير موجود" }, { status: 404 });

  await audit({
    actorId: user.id,
    action: "feedback.attachment_download",
    entityType: "feedback",
    entityId: id,
    summary: `تنزيل مرفق الملاحظة ${row.ref}`,
  });

  const { file, data } = result;
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

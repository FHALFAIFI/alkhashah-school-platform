"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documents, meetings, committees } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { aiEnabled } from "@/lib/ai/provider";
import { draftMeetingSummary } from "@/lib/ai/assist";
import { m365Enabled, createDraftEmail } from "@/lib/email/m365";
import { readStoredFile } from "@/lib/storage";

export type AiState = { error?: string; draft?: string } | null;

/** مسودة تلخيص اجتماع — مقترح نصي يراجعه الإنسان، لا يكتب في أي سجل */
export async function aiMeetingSummaryAction(meetingId: string): Promise<AiState> {
  const user = await requirePermission("committees.write");
  if (!aiEnabled()) return { error: "الذكاء الاصطناعي معطل — يفعل من إعدادات الخادم" };
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!meeting) return { error: "الاجتماع غير موجود" };
  const [committee] = await db.select().from(committees).where(eq(committees.id, meeting.committeeId));
  try {
    const draft = await draftMeetingSummary({
      committeeName: committee.nameAr,
      agenda: meeting.agenda ?? [],
      discussion: meeting.discussion ?? "",
      actorId: user.id,
    });
    return { draft };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذر توليد المسودة" };
  }
}

export type EmailState = { error?: string; webLink?: string | null; fallback?: boolean } | null;

/**
 * مسار البريد: مسودة عبر Microsoft 365 عند تفعيله (لا إرسال نهائي أبداً)،
 * وإلا يوجه المستخدم للبديل: تنزيل PDF وفتح مسودة بريد يدوية.
 */
export async function emailDocumentAction(docId: string, formData: FormData): Promise<EmailState> {
  const user = await requirePermission("documents.read", "reports.generate");
  const [doc] = await db.select().from(documents).where(eq(documents.id, docId));
  if (!doc) return { error: "الوثيقة غير موجودة" };

  if (!m365Enabled()) return { fallback: true };

  if (!doc.pdfFileId) return { error: "الوثيقة بلا ملف PDF" };
  const pdf = await readStoredFile(doc.pdfFileId);
  if (!pdf) return { error: "تعذرت قراءة الملف" };
  try {
    const result = await createDraftEmail({
      to: String(formData.get("to") ?? "") || undefined,
      subject: `${doc.title} — ${doc.docNumber}`,
      bodyHtml: `<p dir="rtl">السلام عليكم ورحمة الله وبركاته،</p><p dir="rtl">مرفق ${doc.title} (رقم الوثيقة: ${doc.docNumber} — رمز التحقق: ${doc.verificationCode}).</p><p dir="rtl">مدير مجمع الخشعة التعليمي للبنين</p>`,
      attachment: { name: `${doc.docNumber}.pdf`, mime: "application/pdf", data: pdf.data },
      actorId: user.id,
    });
    return { webLink: result.webLink };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذر إنشاء المسودة" };
  }
}

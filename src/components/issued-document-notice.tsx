import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";

/**
 * تأكيد إصدار وثيقة رسمية على الشاشة بعد الإجراء (D-053 قاعدة 4 بقيد D-065).
 *
 * ── لماذا يلزم أصلاً ──────────────────────────────────────────────────────
 * إجراءات إصدار الوثائق كانت تنتهي بلا شيء: تصدر الوثيقة برقمها ويُحفظ ملفها، ولا يتغيّر
 * على الشاشة حرف. فيظن المدير أن الزر لم يعمل فيضغطه ثانيةً، فتصدر **وثيقة رسمية مكرّرة
 * برقم جديد**. هذا هو الضرر الذي تمنعه هذه الرسالة: النتيجة تُرى فور وقوعها.
 *
 * ── لماذا تُقرأ من القاعدة لا من العنوان ──────────────────────────────────
 * الرقم يصل في معامل استعلام (وهو ما يجعل الوجهة مختلفة فعلاً فيقع تصيير جديد)، لكنه لا
 * يُصدَّق لمجرّد وجوده: يُبحث عنه في `documents`، فإن لم يقابل وثيقة حقيقية لم تُعرض
 * الرسالة إطلاقاً. فلا يستطيع رابط ملفّق أن يدّعي إصداراً لم يحدث.
 */
export async function IssuedDocumentNotice({
  docNumber,
  label = "صدرت الوثيقة رقم",
}: {
  docNumber: string | null;
  label?: string;
}) {
  if (!docNumber) return null;
  const [doc] = await db
    .select({ id: documents.id, pdfFileId: documents.pdfFileId })
    .from(documents)
    .where(eq(documents.docNumber, docNumber));
  if (!doc) return null;
  return (
    <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
      {label} {docNumber}
      {doc.pdfFileId && (
        <>
          {" — "}
          <a href={`/api/files/${doc.pdfFileId}`} className="underline">
            تنزيل
          </a>
        </>
      )}
    </p>
  );
}

/** قراءة معامل `issued` من عنوان الصفحة — نصّ واحد أو لا شيء */
export function issuedParam(sp: Record<string, string | string[] | undefined>): string | null {
  const v = sp.issued;
  return typeof v === "string" ? v : null;
}

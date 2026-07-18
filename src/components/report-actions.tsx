"use client";

import { EmailDocumentButton } from "@/components/integrations-ui";

/**
 * إجراءات التقرير مجمّعة: طباعة، تنزيل Word، تنزيل Excel، فتح مسودة بريد.
 * مسودة البريد تستخدم سير العمل الحالي (مسودة فقط — لا يرسل النظام تلقائياً) وتعمل على آخر
 * تقرير مُصدَر للكيان؛ فإن لم يصدر بعد يظهر تلميح لإصداره أولاً لإرفاقه.
 */
export function ReportActions({
  wordHref,
  excelHref,
  latestDoc,
}: {
  wordHref: string;
  excelHref: string;
  latestDoc: { id: string; docNumber: string; pdfFileId: string | null } | null;
}) {
  const btn = "rounded-lg border border-sand-200 px-3 py-1.5 text-sm hover:bg-sand-100";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => window.print()} className={btn}>
        طباعة
      </button>
      <a href={wordHref} className={btn}>
        تنزيل Word
      </a>
      <a href={excelHref} className={btn}>
        تنزيل Excel
      </a>
      {latestDoc ? (
        <EmailDocumentButton
          docId={latestDoc.id}
          docNumber={latestDoc.docNumber}
          pdfFileId={latestDoc.pdfFileId}
          label="فتح مسودة بريد"
          triggerClassName={btn}
        />
      ) : (
        <span className="rounded-lg border border-dashed border-sand-300 px-3 py-1.5 text-sm text-gray-400">
          فتح مسودة بريد — أصدر التقرير أولاً لإرفاقه
        </span>
      )}
    </div>
  );
}

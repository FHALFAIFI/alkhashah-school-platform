"use client";

import { useActionState } from "react";
import { uploadImportAction, type ImportActionState } from "../actions";
import { SubmitButton } from "@/components/ui";

export function UploadForm({ importType }: { importType: string }) {
  // D-053: لا تحديث من العميل — الإجراء ينتهي بـ`redirect` إلى صفحة الدفعة عند النجاح،
  // فالوجهة تُصيَّر من جديد، والحالة المُعادة هنا حالة خطأ فقط.
  const [state, formAction, pending] = useActionState<ImportActionState, FormData>(uploadImportAction, null);
  return (
    <form action={formAction} className="space-y-4">
      {state?.error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{state.error}</div>}
      <input type="hidden" name="importType" value={importType} />
      <div>
        <label htmlFor="file" className="mb-1 block text-sm font-medium text-gray-700">
          ملف Excel المصدر
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".xlsx"
          required
          className="w-full rounded-lg border border-dashed border-gray-300 p-4 text-sm"
        />
      </div>
      {pending ? <p className="text-sm text-gray-500">جارٍ التحليل والمعاينة…</p> : <SubmitButton>تحليل ومعاينة</SubmitButton>}
    </form>
  );
}

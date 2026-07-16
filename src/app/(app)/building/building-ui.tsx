"use client";

import { useActionState } from "react";
import { openRoomByCodeAction, type ActionState } from "./actions";
import { SubmitButton } from "@/components/ui";

/**
 * فتح غرفة بالرمز المطبوع — بديل يدوي لمسح QR يعمل عبر HTTP دون كاميرا:
 * يكتب المستخدم الرمز الموجود أسفل ملصق الغرفة فينتقل لصفحتها مباشرة.
 */
export function OpenRoomByCodeForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(openRoomByCodeAction, null);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="min-w-0">
        <label htmlFor="room-code" className="mb-1 block text-sm font-medium text-gray-700">فتح غرفة بالرمز</label>
        <input
          id="room-code"
          name="code"
          dir="ltr"
          placeholder="KHS-RM-0007"
          autoComplete="off"
          className="min-h-11 w-44 max-w-full rounded-lg border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 lg:min-h-0"
        />
      </div>
      <SubmitButton variant="secondary">فتح</SubmitButton>
      {state?.error && (
        <p role="alert" className="w-full text-xs text-red-700 sm:w-auto">{state.error}</p>
      )}
    </form>
  );
}

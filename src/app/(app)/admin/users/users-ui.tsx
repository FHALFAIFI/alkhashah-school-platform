"use client";

import { useActionState } from "react";
import { changePasswordAction, type ActionState } from "./actions";
import { Field, SubmitButton } from "@/components/ui";

export function ChangePasswordForm({ usernames }: { usernames: string[] }) {
  const [state, formAction] = useActionState<ActionState, FormData>(changePasswordAction, null);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      {state?.error && <div role="alert" className="w-full rounded bg-red-50 p-2 text-sm text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="w-full rounded bg-emerald-50 p-2 text-sm text-emerald-700">{state.success}</div>}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">المستخدم</label>
        <select name="username" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" dir="ltr">
          {usernames.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </div>
      <div className="min-w-52">
        <Field label="كلمة المرور الجديدة" name="newPassword" type="password" required dir="ltr" hint="12 حرفاً على الأقل" />
      </div>
      <SubmitButton>تغيير</SubmitButton>
    </form>
  );
}

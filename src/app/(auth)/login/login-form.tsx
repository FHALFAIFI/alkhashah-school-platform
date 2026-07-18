"use client";

import { useActionState } from "react";
import { loginAction } from "./actions";

export function LoginForm({ returnTo }: { returnTo?: string | null }) {
  const [state, formAction, pending] = useActionState(loginAction, null);
  return (
    <form action={formAction} className="space-y-4">
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
      {state?.error && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {state.error}
        </div>
      )}
      <div>
        <label htmlFor="username" className="mb-1 block text-sm font-medium text-gray-700">
          اسم المستخدم
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          required
          dir="ltr"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-end focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-700">
          كلمة المرور
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          dir="ltr"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-end focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
      </div>
      <div>
        <label htmlFor="totp" className="mb-1 block text-sm font-medium text-gray-700">
          رمز التحقق الثنائي <span className="text-gray-400">(إن كان مفعلاً)</span>
        </label>
        <input
          id="totp"
          name="totp"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          dir="ltr"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-end focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-brand-600 py-2.5 font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? "جارٍ الدخول…" : "تسجيل الدخول"}
      </button>
    </form>
  );
}

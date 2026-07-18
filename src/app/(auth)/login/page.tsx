import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { safeImportsReturnTo } from "@/lib/auth/return-to";
import { LoginForm } from "./login-form";

export const metadata = { title: "تسجيل الدخول" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams;
  const safeReturnTo = safeImportsReturnTo(returnTo);
  const user = await getCurrentUser();
  if (user) redirect(safeReturnTo ?? "/dashboard");
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-900 to-brand-700 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-600 text-3xl font-bold text-white">
            خ
          </div>
          <h1 className="text-xl font-bold text-brand-900">منصة الإدارة المدرسية المتكاملة</h1>
          <p className="mt-1 text-sm text-gray-500">مجمع الخشعة التعليمي للبنين</p>
        </div>
        <LoginForm returnTo={safeReturnTo} />
      </div>
    </main>
  );
}

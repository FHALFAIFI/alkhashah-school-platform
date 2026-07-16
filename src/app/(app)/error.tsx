"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-red-200 bg-red-50 p-6 text-center">
      <p className="font-bold text-red-800">حدث خطأ غير متوقع</p>
      <p className="mt-1 text-sm text-red-700">
        {error.message && !/fetch|ECONN|internal/i.test(error.message) ? error.message : "تعذر إتمام العملية — حاول مرة أخرى"}
      </p>
      <button
        onClick={reset}
        className="mt-4 min-h-11 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        إعادة المحاولة
      </button>
    </div>
  );
}

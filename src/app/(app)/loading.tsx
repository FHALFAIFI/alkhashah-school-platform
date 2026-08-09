export default function Loading() {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-gray-500">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-sand-300 border-t-brand-600" aria-hidden />
      <p className="text-sm">جارٍ التحميل…</p>
    </div>
  );
}

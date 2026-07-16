"use client";

import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";

/** قائمة المحادثات السابقة — مع حذف محادثة واحدة أو الكل (سياسة الاحتفاظ تنظف القديم تلقائياً) */
export function ConversationList({
  conversations,
  active,
  csrfToken,
}: {
  conversations: { id: string; title: string }[];
  active: string | null;
  csrfToken: string;
}) {
  const router = useRouter();

  const remove = async (id: string | null) => {
    if (!confirm(id ? "حذف هذه المحادثة؟" : "حذف كل المحادثات؟")) return;
    await fetch(id ? `/api/ai/conversations/${id}` : "/api/ai/conversations", {
      method: "DELETE",
      headers: { "x-csrf-token": csrfToken },
    });
    router.push("/assistant");
    router.refresh();
  };

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-600">المحادثات</h2>
        {conversations.length > 0 && (
          <button onClick={() => void remove(null)} className="text-xs text-red-600 underline">حذف الكل</button>
        )}
      </div>
      {conversations.length === 0 ? (
        <p className="text-xs text-gray-400">لا محادثات محفوظة</p>
      ) : (
        <ul className="max-h-72 space-y-1 overflow-y-auto lg:max-h-[60vh]">
          <li>
            <a href="/assistant" className="block rounded-lg px-2 py-2 text-sm font-medium text-brand-700 hover:bg-sand-100">
              + محادثة جديدة
            </a>
          </li>
          {conversations.map((c) => (
            <li key={c.id} className="group flex items-center gap-1">
              <a
                href={`/assistant?محادثة=${c.id}`}
                className={`min-w-0 flex-1 truncate rounded-lg px-2 py-2 text-sm hover:bg-sand-100 ${active === c.id ? "bg-sand-100 font-medium" : "text-gray-600"}`}
              >
                {c.title}
              </a>
              <button
                onClick={() => void remove(c.id)}
                aria-label={`حذف محادثة ${c.title}`}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs text-gray-400 hover:bg-red-50 hover:text-red-600"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

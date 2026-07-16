"use client";

import { useTransition } from "react";
import { deleteDraftAction } from "../actions";

export function DeleteDraftButton({ draftId }: { draftId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      onClick={() => {
        if (confirm("حذف هذه المسودة؟")) startTransition(() => deleteDraftAction(draftId));
      }}
      disabled={pending}
      className="flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-xs text-gray-400 hover:bg-red-50 hover:text-red-600"
    >
      حذف
    </button>
  );
}

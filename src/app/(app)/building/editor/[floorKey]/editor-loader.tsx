"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type PlanEditor from "./plan-editor";

/** Konva يعمل في المتصفح فقط — تحميل كسول بلا SSR */
const LazyEditor = dynamic(() => import("./plan-editor"), {
  ssr: false,
  loading: () => <div className="rounded-xl border border-sand-200 bg-white p-10 text-center text-sm text-gray-400">جارٍ تحميل المحرر…</div>,
});

export function EditorLoader(props: ComponentProps<typeof PlanEditor>) {
  return <LazyEditor {...props} />;
}

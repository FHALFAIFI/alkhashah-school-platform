import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json(
    {
      name: "منصة الإدارة المدرسية المتكاملة",
      short_name: "منصة المدرسة",
      description: "مجمع الخشعة التعليمي للبنين",
      dir: "rtl",
      lang: "ar",
      start_url: "/dashboard",
      display: "standalone",
      background_color: "#faf9f7",
      theme_color: "#1f5244",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json" } },
  );
}

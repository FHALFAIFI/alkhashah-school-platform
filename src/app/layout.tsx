import type { Metadata, Viewport } from "next";
import { ErrorDiagnostics } from "@/components/error-diagnostics";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "منصة الإدارة المدرسية المتكاملة",
    template: "%s — منصة الإدارة المدرسية المتكاملة",
  },
  description: "مجمع الخشعة التعليمي للبنين",
  applicationName: "منصة الإدارة المدرسية المتكاملة",
  manifest: "/manifest.webmanifest",
  // منع الترجمة الآلية للمتصفح: الواجهة عربية بالكامل، وترجمة Chrome/Edge تلفّ العُقَد النصية
  // بعناصر <font> فتنكسر مطابقة React عند أي تحديث (خطأ insertBefore عبر التطبيق) — D-029.
  other: { google: "notranslate" },
};

export const viewport: Viewport = {
  themeColor: "#1f5244",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" translate="no">
      <body>
        <ErrorDiagnostics />
        {children}
      </body>
    </html>
  );
}

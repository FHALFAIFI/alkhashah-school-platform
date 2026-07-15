import type { Metadata, Viewport } from "next";
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
};

export const viewport: Viewport = {
  themeColor: "#1f5244",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}

import type { NextConfig } from "next";

/**
 * الأصول الموثوقة لإجراءات الخادم خلف وسيط HTTPS (مثل Tailscale Serve):
 * تضبط عبر TRUSTED_ORIGINS (فواصل) دون تثبيت اسم جهاز بعينه في الشيفرة.
 * مثال: TRUSTED_ORIGINS=faheds-mac-mini.tailXXXX.ts.net
 * والنمط *.ts.net يسمح بأي جهاز على الشبكة الخاصة عند عدم الضبط.
 */
const trustedOrigins = (process.env.TRUSTED_ORIGINS ?? "*.ts.net")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  serverExternalPackages: ["@node-rs/argon2", "playwright", "exceljs", "@napi-rs/canvas", "pdfjs-dist", "adm-zip", "pg"],
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
      allowedOrigins: trustedOrigins,
    },
  },
};

export default nextConfig;

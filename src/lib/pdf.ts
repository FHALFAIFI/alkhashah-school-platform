import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * توليد PDF عربي A4 من HTML مضبوط عبر متصفح Playwright Chromium —
 * الخط مضمن محلياً (لا جلب من الشبكة إطلاقاً).
 */

let fontCss: string | null = null;

function getFontCss(): string {
  if (fontCss) return fontCss;
  const base = path.resolve("node_modules/@fontsource/ibm-plex-sans-arabic/files");
  const regular = readFileSync(path.join(base, "ibm-plex-sans-arabic-arabic-400-normal.woff2")).toString("base64");
  const bold = readFileSync(path.join(base, "ibm-plex-sans-arabic-arabic-700-normal.woff2")).toString("base64");
  fontCss = `
    @font-face { font-family: 'IBM Plex Sans Arabic'; font-weight: 400; src: url(data:font/woff2;base64,${regular}) format('woff2'); }
    @font-face { font-family: 'IBM Plex Sans Arabic'; font-weight: 700; src: url(data:font/woff2;base64,${bold}) format('woff2'); }
  `;
  return fontCss;
}

export function officialPageHtml(opts: {
  title: string;
  bodyHtml: string;
  docNumber?: string;
  verificationCode?: string;
  issuedAtText?: string;
  signatureDataUri?: string | null;
  stampDataUri?: string | null;
}): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<style>
${getFontCss()}
* { box-sizing: border-box; }
body { font-family: 'IBM Plex Sans Arabic', sans-serif; color: #1a1a1a; margin: 0; font-size: 12px; line-height: 1.7; }
.header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1f5244; padding-bottom: 8px; margin-bottom: 16px; }
.header .org { font-size: 10px; line-height: 1.6; }
.header .title { text-align: center; }
h1 { font-size: 16px; color: #1f5244; margin: 0 0 4px; }
h2 { font-size: 13px; color: #1f5244; border-inline-start: 3px solid #348066; padding-inline-start: 8px; margin: 16px 0 8px; }
table { width: 100%; border-collapse: collapse; margin: 8px 0; }
th, td { border: 1px solid #cfcabc; padding: 5px 7px; text-align: right; vertical-align: top; }
th { background: #f2f0eb; font-weight: 700; }
.meta { font-size: 10px; color: #555; }
.evidence-img { max-width: 100%; max-height: 340px; border: 1px solid #ddd; border-radius: 4px; margin: 4px 0; }
.truncation-note { color: #8a6d00; background: #fff8e0; padding: 4px 8px; border-radius: 4px; font-size: 10px; }
.signatures { display: flex; justify-content: space-between; margin-top: 32px; page-break-inside: avoid; }
.sig-block { text-align: center; width: 40%; }
.sig-line { border-top: 1px solid #999; margin-top: 44px; padding-top: 4px; font-size: 11px; }
.sig-img { max-height: 60px; display: block; margin: 0 auto; }
.stamp-img { max-height: 90px; opacity: 0.9; }
.footer { position: fixed; bottom: 0; inset-inline: 0; border-top: 1px solid #ddd; padding: 4px 0; font-size: 9px; color: #777; display: flex; justify-content: space-between; }
.badge { display: inline-block; border-radius: 8px; padding: 1px 8px; font-size: 10px; background: #f2f0eb; }
</style>
</head>
<body>
<div class="header">
  <div class="org">
    المملكة العربية السعودية<br>وزارة التعليم<br>إدارة التعليم في محافظة صبيا<br>مكتب تعليم العيدابي<br><strong>مجمع الخشعة التعليمي للبنين</strong>
  </div>
  <div class="title">
    <h1>${opts.title}</h1>
    <div class="meta">منصة الإدارة المدرسية المتكاملة</div>
  </div>
  <div class="org meta">
    ${opts.docNumber ? `رقم الوثيقة: <strong>${opts.docNumber}</strong><br>` : ""}
    ${opts.verificationCode ? `رمز التحقق: <strong>${opts.verificationCode}</strong><br>` : ""}
    ${opts.issuedAtText ? `تاريخ الإصدار: ${opts.issuedAtText}` : ""}
  </div>
</div>
${opts.bodyHtml}
${
  opts.signatureDataUri || opts.stampDataUri
    ? `<div class="signatures">
        <div class="sig-block">
          ${opts.signatureDataUri ? `<img class="sig-img" src="${opts.signatureDataUri}" alt="">` : ""}
          <div class="sig-line">مدير المجمع</div>
        </div>
        <div class="sig-block">
          ${opts.stampDataUri ? `<img class="stamp-img" src="${opts.stampDataUri}" alt="">` : ""}
        </div>
      </div>`
    : ""
}
</body>
</html>`;
}

export async function htmlToPdf(html: string): Promise<Buffer> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ args: ["--font-render-hinting=none"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({
      format: "A4",
      margin: { top: "15mm", bottom: "15mm", left: "12mm", right: "12mm" },
      printBackground: true,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

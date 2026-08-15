import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { escapeHtml } from "@/lib/html-escape";

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

/** ترويسة محلولة من هوية الوثائق المركزية (§6/§8) — تُحقن هنا وتُجمّد ضمن لقطة الوثيقة. */
export type PageHeaderIdentity = {
  orgLines: string[];
  headerNote?: string;
  footerNote?: string;
  principalName?: string;
  academicYear?: string;
  signerTitle?: string;
  /** شعارا الوزارة والمدرسة كـ data URIs محلية — لا جلب شبكي وقت التوليد (§8) */
  ministryLogoDataUri?: string;
  schoolLogoDataUri?: string;
};

export function officialPageHtml(opts: {
  title: string;
  bodyHtml: string;
  docNumber?: string;
  verificationCode?: string;
  issuedAtText?: string;
  signatureDataUri?: string | null;
  stampDataUri?: string | null;
  /** الهوية المركزية؛ عند غيابها تُستعمل القيم الرسمية الافتراضية للمجمع (توافق رجعي) */
  identity?: PageHeaderIdentity;
}): string {
  // كل قيمة تُحقن هنا تُهرَّب: العناوين تُبنى من أسماء يُدخلها المستخدم (اسم برنامج،
  // اسم لجنة، اسم منسوب)، والهوية قابلة للتحرير من إدارة القوالب. بلا تهريب يصبح اسم
  // مثل `<img src=x onerror=…>` وسماً حياً داخل لقطة الوثيقة المجمّدة، ويُنفَّذ أيضاً في
  // متصفّح Chromium أثناء توليد PDF على الخادم.
  const org = opts.identity?.orgLines?.length
    ? opts.identity.orgLines
        .map((l, i) => (i === opts.identity!.orgLines.length - 1 ? `<strong>${escapeHtml(l)}</strong>` : escapeHtml(l)))
        .join("<br>")
    : "المملكة العربية السعودية<br>وزارة التعليم<br>إدارة التعليم في محافظة صبيا<br><strong>مجمع الخشعة التعليمي للبنين</strong>";
  const metaNote = escapeHtml(opts.identity?.footerNote ?? "منصة الإدارة المدرسية المتكاملة");
  const headerNote = opts.identity?.headerNote ? `<br>${escapeHtml(opts.identity.headerNote)}` : "";
  const yearLine = opts.identity?.academicYear ? `<br>العام الدراسي: ${escapeHtml(opts.identity.academicYear)}` : "";
  const signerTitle = escapeHtml(opts.identity?.signerTitle ?? "مدير المجمع");
  const principalLine = opts.identity?.principalName ? `<br>${escapeHtml(opts.identity.principalName)}` : "";
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
/* شعارات رسمية: أبعاد ثابتة الاحتواء بلا تشويه، وبياض كافٍ حولها (§8) */
.header .logo { max-height: 58px; max-width: 90px; object-fit: contain; display: block; margin: 0 auto 4px; }
.header .logo-box { text-align: center; padding-inline: 8px; }
h1 { font-size: 16px; color: #1f5244; margin: 0 0 4px; }
h2 { font-size: 13px; color: #1f5244; border-inline-start: 3px solid #348066; padding-inline-start: 8px; margin: 16px 0 8px; }
table { width: 100%; border-collapse: collapse; margin: 8px 0; }
th, td { border: 1px solid #cfcabc; padding: 5px 7px; text-align: right; vertical-align: top; }
th { background: #f2f0eb; font-weight: 700; }
/* التقارير الطويلة (v2.3 §7): ترويسة الجدول تتكرر مع كل صفحة، والصف لا ينقسم بين صفحتين */
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
h2 { page-break-after: avoid; }
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
  <div style="display:flex;align-items:flex-start;gap:6px;">
    ${
      opts.identity?.ministryLogoDataUri
        ? `<div class="logo-box"><img class="logo" src="${escapeHtml(opts.identity.ministryLogoDataUri)}" alt="شعار وزارة التعليم"></div>`
        : ""
    }
    <div class="org">
      ${org}${headerNote}
    </div>
  </div>
  <div class="title">
    <h1>${escapeHtml(opts.title)}</h1>
    <div class="meta">${metaNote}${yearLine}</div>
  </div>
  <div style="display:flex;align-items:flex-start;gap:6px;">
    <div class="org meta">
      ${opts.docNumber ? `رقم الوثيقة: <strong>${escapeHtml(opts.docNumber)}</strong><br>` : ""}
      ${opts.verificationCode ? `رمز التحقق: <strong>${escapeHtml(opts.verificationCode)}</strong><br>` : ""}
      ${opts.issuedAtText ? `تاريخ الإصدار: ${escapeHtml(opts.issuedAtText)}` : ""}
    </div>
    ${
      opts.identity?.schoolLogoDataUri
        ? `<div class="logo-box"><img class="logo" src="${escapeHtml(opts.identity.schoolLogoDataUri)}" alt="شعار المدرسة"></div>`
        : ""
    }
  </div>
</div>
${opts.bodyHtml}
${
  opts.signatureDataUri || opts.stampDataUri || opts.identity?.principalName
    ? `<div class="signatures">
        <div class="sig-block">
          ${opts.signatureDataUri ? `<img class="sig-img" src="${escapeHtml(opts.signatureDataUri)}" alt="">` : ""}
          <div class="sig-line">${signerTitle}${principalLine}</div>
        </div>
        <div class="sig-block">
          ${opts.stampDataUri ? `<img class="stamp-img" src="${escapeHtml(opts.stampDataUri)}" alt="">` : ""}
        </div>
      </div>`
    : ""
}
</body>
</html>`;
}

export async function htmlToPdf(html: string, opts?: { pageNumbers?: boolean; preferCssPageSize?: boolean }): Promise<Buffer> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ args: ["--font-render-hinting=none"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({
      format: "A4",
      // v2.6 §F: الوثيقة ذات الأقسام الأفقية تعلن أحجام صفحاتها بقواعد `@page` المسماة،
      // وهذا الخيار يجعل Chromium يحترمها — فتختلط الصفحات الرأسية والأفقية في ملف واحد
      ...(opts?.preferCssPageSize ? { preferCSSPageSize: true } : {}),
      margin: { top: "15mm", bottom: "15mm", left: "12mm", right: "12mm" },
      printBackground: true,
      // أرقام الصفحات للتقارير الطويلة (v2.3 §7) — من مولّد PDF نفسه فتصح مهما طال التقرير
      ...(opts?.pageNumbers
        ? {
            displayHeaderFooter: true,
            headerTemplate: "<span></span>",
            footerTemplate:
              '<div style="width:100%;text-align:center;font-size:8px;color:#777;" dir="rtl">صفحة <span class="pageNumber"></span> من <span class="totalPages"></span></div>',
          }
        : {}),
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { escapeHtml } from "@/lib/html-escape";
import { dualNumericCell } from "@/lib/dates";
import { readStoredFile } from "@/lib/storage";
import type { SnapshotDoc, SnapshotSection, SnapshotColumn } from "./options";
import { styleConfigSchema, resolveStyleConfig, type StyleConfig } from "./base-templates";
import { LARGE_REPORT_ROWS } from "../export-safety";

/**
 * تصيير وثيقة التقرير (v2.6 §F — D-060): `SnapshotDoc` → HTML كامل.
 *
 * **المصيّر الواحد** لمسارين: صفحة المعاينة المطبوعة (`/print`) وتوليد PDF — الاثنان
 * يستدعيان `instanceHtml` نفسها، فتطابق المعاينة والملف تطابق مصدرٍ لا تطابق اجتهاد.
 * (معاينة المنشئ التفاعلية تُصيَّر بمكوّنات React من `SnapshotDoc` ذاته — بنية واحدة،
 * طبقتا عرض.)
 *
 * قواعد الصفحة (§F):
 *  - الغلاف والفهرس تلقائيان: يظهران للتقرير الطويل ما لم يقل القالب غير ذلك.
 *  - الجدول العريض يُدار تلقائياً: أفقي فوق 8 أعمدة (صفحات مسماة `@page landscape` مع
 *    `preferCSSPageSize`)، وتصغير محكوم فوق 13، وتقسيم بمجموعات أعمدة فوق 18 مع تكرار
 *    العمود الأول — لا قصّ صامتاً أبداً.
 *  - ترويسة الجدول تتكرر مع كل صفحة (`thead`)، والصف لا ينقسم، والعنوان لا يُيتَّم.
 *  - الرسم البياني يحمل قيمه المطبوعة بجانب أعمدته — مقروء بتدرّج الرمادي، لا لون وحده.
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

/** إعداد القالب من اللقطة — لقطة قديمة أو معطوبة تعود إلى الأساس الرسمي بدل أن تفشل */
export function styleOf(doc: SnapshotDoc): StyleConfig {
  const parsed = styleConfigSchema.safeParse(doc.style);
  return parsed.success ? parsed.data : resolveStyleConfig(doc.templateKey);
}

/** التقرير طويل إذا كبُر حجمه أو تعدّدت أقسامه — معيار الغلاف والفهرس التلقائيين (§F) */
export function isLongReport(doc: SnapshotDoc): boolean {
  return doc.stats.totalRows > LARGE_REPORT_ROWS / 5 || doc.sections.length > 3;
}

export function wantsCover(doc: SnapshotDoc, style: StyleConfig): boolean {
  if (style.cover === "نعم") return true;
  if (style.cover === "لا") return false;
  return isLongReport(doc);
}

export function wantsToc(doc: SnapshotDoc, style: StyleConfig): boolean {
  if (style.toc === "نعم") return true;
  if (style.toc === "لا") return false;
  return isLongReport(doc) && doc.sections.length > 1;
}

/* ─────────────────── تخطيط الجدول العريض (§F) — دالة خالصة قابلة للاختبار ─────────────────── */

export type TableLayout = {
  orientation: "portrait" | "landscape";
  /** معامل تصغير الخط: 1 كامل، ثم درجات محكومة لا تصغيراً حراً */
  fontScale: 1 | 0.85 | 0.75;
  /** عدد الأعمدة الأقصى لكل مقطع عند التقسيم — العمود الأول يتكرر في كل مقطع */
  splitAt: number | null;
};

export function tableLayoutFor(columnCount: number): TableLayout {
  if (columnCount <= 8) return { orientation: "portrait", fontScale: 1, splitAt: null };
  if (columnCount <= 13) return { orientation: "landscape", fontScale: 1, splitAt: null };
  if (columnCount <= 18) return { orientation: "landscape", fontScale: 0.85, splitAt: null };
  return { orientation: "landscape", fontScale: 0.75, splitAt: 12 };
}

/** تقسيم الأعمدة إلى مجموعات مع تكرار عمود الهوية الأول في كل مجموعة */
export function splitColumns(columns: SnapshotColumn[], splitAt: number): SnapshotColumn[][] {
  if (columns.length <= splitAt) return [columns];
  const [first, ...rest] = columns;
  const groups: SnapshotColumn[][] = [];
  for (let i = 0; i < rest.length; i += splitAt - 1) {
    groups.push([first, ...rest.slice(i, i + splitAt - 1)]);
  }
  return groups;
}

/* ─────────────────── تنسيق الخلايا — التنسيق نفسه في كل صيغة ─────────────────── */

export function cellText(value: string | number | null | undefined, type?: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (type === "date" && typeof value === "string") return dualNumericCell(value);
  return String(value);
}

/* ─────────────────── الرسم البياني (§F) ─────────────────── */

/** القسم يصلح رسماً: عمودا تسمية وعدد لا غير، وصفوف قليلة تُقرأ أعمدةً */
export function chartable(section: SnapshotSection): { labelKey: string; valueKey: string } | null {
  if (section.columns.length < 2 || section.rows.length === 0 || section.rows.length > 15) return null;
  const numeric = section.columns.filter((c) => c.type === "number");
  const textual = section.columns.filter((c) => c.type !== "number" && c.type !== "money" && c.type !== "percent");
  if (numeric.length === 0 || textual.length === 0) return null;
  if (section.columns.length > 3) return null;
  return { labelKey: textual[0].key, valueKey: numeric[0].key };
}

function chartHtml(section: SnapshotSection, style: StyleConfig): string {
  const spec = chartable(section);
  if (!spec) return "";
  const values = section.rows.map((r) => ({
    label: cellText(r[spec.labelKey]),
    value: typeof r[spec.valueKey] === "number" ? (r[spec.valueKey] as number) : 0,
  }));
  const max = Math.max(...values.map((v) => v.value), 1);
  const bars = values
    .map(
      (v) => `
      <div class="chart-row">
        <div class="chart-label">${escapeHtml(v.label)}</div>
        <div class="chart-track"><div class="chart-bar" style="width:${Math.round((v.value / max) * 100)}%"></div></div>
        <div class="chart-value">${v.value}</div>
      </div>`,
    )
    .join("");
  return `<div class="chart" style="--bar:${escapeHtml(style.primaryColor)}">${bars}</div>`;
}

/* ─────────────────── مقاطع الوثيقة ─────────────────── */

function sectionTableHtml(section: SnapshotSection, layout: TableLayout): string {
  const groups = layout.splitAt ? splitColumns(section.columns, layout.splitAt) : [section.columns];
  return groups
    .map((cols, gi) => {
      const partNote =
        groups.length > 1 ? `<p class="meta">جزء ${gi + 1} من ${groups.length} — العمود الأول مكرر للربط</p>` : "";
      const head = cols.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("");
      const body = section.rows
        .map(
          (r) =>
            `<tr>${cols.map((c) => `<td>${escapeHtml(cellText(r[c.key], c.type))}</td>`).join("")}</tr>`,
        )
        .join("\n");
      return `${partNote}<table style="font-size:${layout.fontScale}em"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    })
    .join("\n");
}

function sectionHtml(section: SnapshotSection, index: number, style: StyleConfig): string {
  const layout = tableLayoutFor(section.columns.length);
  const pageClass = layout.orientation === "landscape" ? "landscape-section" : "";
  const filterLines = section.filterLines.length
    ? `<p class="meta">${section.filterLines.map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(v)}`).join(" · ")}</p>`
    : "";
  const truncNote = section.truncated
    ? `<p class="truncation-note">اقتُطع القسم عند حدّه الأقصى — ضيّق المرشّحات ليكتمل.</p>`
    : "";
  const content = section.empty
    ? `<p class="meta">لا بيانات مطابقة للمرشّحات في هذا القسم.</p>`
    : `${chartHtml(section, style)}${sectionTableHtml(section, layout)}`;
  return `
  <section class="report-section ${pageClass}" id="section-${escapeHtml(section.key)}">
    <h2>${index + 1}. ${escapeHtml(section.label)}</h2>
    ${filterLines}
    <p class="meta">عدد الصفوف: ${section.total}</p>
    ${truncNote}
    ${content}
  </section>`;
}

async function logoDataUri(fileId: string | null): Promise<string | null> {
  if (!fileId) return null;
  try {
    const stored = await readStoredFile(fileId);
    if (!stored) return null;
    return `data:${stored.file.mime};base64,${stored.data.toString("base64")}`;
  } catch {
    return null;
  }
}

export type InstanceHtmlOptions = {
  reportNumber?: string | null;
  /** «مسودة» تُختم عرضياً على غير المعتمد — المعاينة لا تُشبه وثيقة صادرة */
  draftBanner?: boolean;
};

export async function instanceHtml(doc: SnapshotDoc, opts: InstanceHtmlOptions = {}): Promise<string> {
  const style = styleOf(doc);
  const showIdentity = style.showIdentity;
  const [ministryLogo, schoolLogo] = showIdentity && style.showLogos
    ? await Promise.all([logoDataUri(doc.identity.ministryLogoFileId), logoDataUri(doc.identity.schoolLogoFileId)])
    : [null, null];

  const orgHtml = showIdentity
    ? doc.identity.orgLines
        .map((l, i) => (i === doc.identity.orgLines.length - 1 ? `<strong>${escapeHtml(l)}</strong>` : escapeHtml(l)))
        .join("<br>")
    : "";

  const headerNote = showIdentity && (style.headerText || doc.identity.headerNote)
    ? `<br>${escapeHtml(style.headerText || doc.identity.headerNote)}`
    : "";
  // بيانات الاتصال المركزية أو المتجاوزة لهذا التقرير (§E) — تُهرَّب كسائر قيم الهوية
  const contactLine = showIdentity && doc.identity.contactInfo
    ? `<br><span class="contact">${escapeHtml(doc.identity.contactInfo)}</span>`
    : "";

  const cover = wantsCover(doc, style)
    ? `
  <section class="cover">
    ${schoolLogo ? `<img class="cover-logo" src="${escapeHtml(schoolLogo)}" alt="">` : ""}
    ${showIdentity ? `<div class="cover-org">${orgHtml}</div>` : ""}
    <h1 class="cover-title">${escapeHtml(doc.title)}</h1>
    <div class="cover-meta">
      <div>${escapeHtml(doc.typeLabel)}</div>
      ${doc.periodText ? `<div>الفترة: ${escapeHtml(doc.periodText)}</div>` : ""}
      ${opts.reportNumber ? `<div>رقم التقرير: <strong>${escapeHtml(opts.reportNumber)}</strong></div>` : ""}
      <div>تاريخ الإصدار: ${escapeHtml(doc.generatedAtText)}</div>
      ${showIdentity && doc.identity.academicYear ? `<div>العام الدراسي: ${escapeHtml(doc.identity.academicYear)}</div>` : ""}
    </div>
  </section>`
    : "";

  const toc = wantsToc(doc, style)
    ? `
  <nav class="toc">
    <h2>المحتويات</h2>
    <ol>${doc.sections.map((s) => `<li>${escapeHtml(s.label)}</li>`).join("")}</ol>
  </nav>`
    : "";

  const attachments = doc.attachments.length
    ? `
  <section class="report-section">
    <h2>${doc.sections.length + 1}. الشواهد والمرفقات المستعملة</h2>
    <table><thead><tr><th>م</th><th>المرفق</th><th>المصدر</th></tr></thead><tbody>
      ${doc.attachments.map((a, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(a.name)}</td><td>${escapeHtml(a.source)}</td></tr>`).join("")}
    </tbody></table>
  </section>`
    : "";

  const approval = style.approvalBox
    ? `
  <div class="signatures">
    <div class="sig-block">
      <div class="sig-line">${escapeHtml(doc.identity.principalTitle || "مدير المدرسة")}${
        doc.identity.principalName ? `<br>${escapeHtml(doc.identity.principalName)}` : ""
      }</div>
    </div>
    <div class="sig-block"><div class="sig-line">الختم</div></div>
  </div>`
    : "";

  const draftStamp = opts.draftBanner ? `<div class="draft-stamp">مسودة — غير معتمدة</div>` : "";

  const header = showIdentity
    ? `
  <div class="header">
    <div style="display:flex;align-items:flex-start;gap:6px;">
      ${ministryLogo ? `<div class="logo-box"><img class="logo" src="${escapeHtml(ministryLogo)}" alt="شعار وزارة التعليم"></div>` : ""}
      <div class="org">${orgHtml}${headerNote}${contactLine}</div>
    </div>
    <div class="title-box">
      <h1>${escapeHtml(doc.title)}</h1>
      <div class="meta">${escapeHtml(doc.typeLabel)}${doc.periodText ? ` — ${escapeHtml(doc.periodText)}` : ""}</div>
    </div>
    <div style="display:flex;align-items:flex-start;gap:6px;">
      <div class="org meta">
        ${opts.reportNumber ? `رقم التقرير: <strong>${escapeHtml(opts.reportNumber)}</strong><br>` : ""}
        تاريخ الإصدار: ${escapeHtml(doc.generatedAtText)}
        ${doc.identity.academicYear ? `<br>العام الدراسي: ${escapeHtml(doc.identity.academicYear)}` : ""}
      </div>
      ${schoolLogo ? `<div class="logo-box"><img class="logo" src="${escapeHtml(schoolLogo)}" alt="شعار المدرسة"></div>` : ""}
    </div>
  </div>`
    : `<div class="header plain-header"><h1>${escapeHtml(doc.title)}</h1><div class="meta">${
        opts.reportNumber ? `رقم التقرير: ${escapeHtml(opts.reportNumber)} — ` : ""
      }${escapeHtml(doc.generatedAtText)}</div></div>`;

  const footerText = style.footerText || (showIdentity ? doc.identity.footerNote : "");

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>${escapeHtml(doc.title)}</title>
<style>
${getFontCss()}
@page { size: A4; margin: 15mm 12mm; }
@page landscape { size: A4 landscape; }
.landscape-section { page: landscape; }
* { box-sizing: border-box; }
body { font-family: 'IBM Plex Sans Arabic', sans-serif; color: #1a1a1a; margin: 0; font-size: ${style.density === "مضغوط" ? "11px" : "12px"}; line-height: 1.7; }
.header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid ${escapeHtml(style.primaryColor)}; padding-bottom: 8px; margin-bottom: 16px; }
.header .org { font-size: 10px; line-height: 1.6; }
.header .contact { color: #555; }
.title-box { text-align: center; }
.plain-header { display: block; text-align: center; }
.logo { max-height: 58px; max-width: 90px; object-fit: contain; display: block; margin: 0 auto 4px; }
.logo-box { text-align: center; padding-inline: 8px; }
h1 { font-size: 16px; color: ${escapeHtml(style.primaryColor)}; margin: 0 0 4px; }
h2 { font-size: 13px; color: ${escapeHtml(style.primaryColor)}; border-inline-start: 3px solid ${escapeHtml(style.accentColor)}; padding-inline-start: 8px; margin: 16px 0 8px; page-break-after: avoid; }
table { width: 100%; border-collapse: collapse; margin: 8px 0; }
th, td { border: 1px solid #cfcabc; padding: ${style.density === "مضغوط" ? "3px 5px" : "5px 7px"}; text-align: right; vertical-align: top; }
th { background: #f2f0eb; font-weight: 700; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
.report-section { page-break-inside: auto; }
.meta { font-size: 10px; color: #555; }
.truncation-note { color: #8a6d00; background: #fff8e0; padding: 4px 8px; border-radius: 4px; font-size: 10px; }
.cover { page-break-after: always; text-align: center; padding-top: 60mm; }
.cover-logo { max-height: 110px; margin: 0 auto 24px; display: block; }
.cover-org { font-size: 12px; line-height: 1.9; margin-bottom: 32px; }
.cover-title { font-size: 26px; margin: 24px 0; }
.cover-meta { font-size: 13px; line-height: 2.2; color: #333; }
.toc { page-break-after: always; }
.toc ol { line-height: 2.2; }
.chart { margin: 8px 0 12px; }
.chart-row { display: flex; align-items: center; gap: 8px; margin: 3px 0; page-break-inside: avoid; }
.chart-label { width: 32%; font-size: 11px; text-align: left; }
.chart-track { flex: 1; background: #f2f0eb; border: 1px solid #e5e1d8; border-radius: 3px; height: 14px; }
.chart-bar { background: var(--bar, ${escapeHtml(style.primaryColor)}); height: 100%; border-radius: 3px; min-width: 2px; }
.chart-value { width: 48px; font-size: 11px; font-weight: 700; }
.signatures { display: flex; justify-content: space-between; margin-top: 32px; page-break-inside: avoid; }
.sig-block { text-align: center; width: 40%; }
.sig-line { border-top: 1px solid #999; margin-top: 44px; padding-top: 4px; font-size: 11px; }
.draft-stamp { position: fixed; top: 40%; inset-inline: 0; text-align: center; font-size: 64px; color: rgba(180, 40, 40, 0.13); transform: rotate(-18deg); font-weight: 700; pointer-events: none; z-index: 10; }
.footer-note { position: fixed; bottom: 0; inset-inline: 0; border-top: 1px solid #ddd; padding: 4px 0; font-size: 9px; color: #777; text-align: center; }
</style>
</head>
<body>
${draftStamp}
${cover}
${header}
${toc}
${doc.sections.map((s, i) => sectionHtml(s, i, style)).join("\n")}
${attachments}
${approval}
${footerText ? `<div class="footer-note">${escapeHtml(footerText)}</div>` : ""}
</body>
</html>`;
}

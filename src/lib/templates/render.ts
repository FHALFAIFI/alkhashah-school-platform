import { escapeHtml } from "@/lib/html-escape";
import { renderPlaceholders } from "./placeholders";
import {
  mergeWithDefaults,
  TEMPLATE_COLORS,
  TEMPLATE_FONTS,
  TEXT_ALIGNMENTS,
  BORDER_STYLES,
  type TemplateConfig,
  type TemplateDocType,
} from "./schema";
import { columnsFor, resolveColumns, resolveSections } from "./structure";

/**
 * تصيير القالب (v2.2 §E2/§E4) — يبني CSS وHTML من الإعداد المُتحقَّق منه.
 *
 * وحدة خالصة بلا وصول لقاعدة البيانات، فتُختبر وحدوياً وتُستعمل في المعاينة والإصدار معاً
 * (نفس المُصيِّر للاثنين — فما يراه المدير في المعاينة هو ما يصدر فعلاً).
 *
 * الضمان الأمني: **لا قيمة من المستخدم تدخل CSS إلا بعد مطابقتها بقائمة مغلقة.**
 * القيم النصية تُهرَّب. القيم العددية تُحصر بمدى. لا `url()` ولا `@import` ولا خط بعيد
 * ولا صورة خارجية — الشعار يُشار إليه بمعرّف ملف داخلي يُحوَّل إلى data URI عند التصيير.
 */

/** قيمة من قائمة مغلقة أو البديل الافتراضي — لا تمر قيمة غير معروفة إلى CSS أبداً */
function pick<T extends readonly string[]>(allowed: T, value: unknown, fallback: T[number]): T[number] {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T[number]) : fallback;
}

/** عدد محصور بمدى — يمنع قيمة تُفسد الصفحة أو تُستعمل لاستنزاف المُصيِّر */
function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * صفوف جدول الوثيقة. المفاتيح من سجل أعمدة النوع المغلق، والقيم نصوص عادية تُهرَّب
 * عند التصيير — لا HTML من مصدر البيانات.
 */
export type RenderTable = Record<string, string | number | null | undefined>[];

export type RenderContext = {
  /** قيم العناصر النائبة — تُهرَّب عند الاستبدال */
  values: Record<string, string | number | null | undefined>;
  /** نوع الوثيقة — يحدّد أعمدة الجدول المتاحة */
  docType?: TemplateDocType;
  /** صفوف جدول المحتوى — تُصفّى وتُرتَّب بحسب إعداد الأعمدة */
  table?: RenderTable;
  /** محتوى إضافي للجسم مُولَّد من الخادم (HTML مهرَّب أصلاً) — يظهر داخل قسم «المحتوى» */
  bodyHtml?: string;
  /** data URI للشعار — يُبنى من ملف مخزَّن داخلياً لا من عنوان خارجي */
  logoDataUri?: string | null;
};

/** بناء CSS من الإعداد — كل قيمة إمّا من قائمة مغلقة أو عدد محصور */
export function buildTemplateCss(config: TemplateConfig): string {
  const s = mergeWithDefaults(config).style ?? {};
  const primary = pick(TEMPLATE_COLORS, s.primaryColor, "#1f5244");
  const text = pick(TEMPLATE_COLORS, s.textColor, "#1a1a1a");
  const font = pick(TEMPLATE_FONTS, s.fontFamily, "IBM Plex Sans Arabic");
  const align = pick(TEXT_ALIGNMENTS, s.textAlign, "right");
  const border = pick(BORDER_STYLES, s.borderStyle, "solid");
  const headerBg = pick(TEMPLATE_COLORS, s.tableHeaderBackground, "#1a1a1a");

  const baseSize = clamp(s.baseFontSize, 8, 24, 12);
  const titleSize = clamp(s.titleFontSize, 8, 24, 16);
  const lineHeight = clamp(s.lineHeight, 1, 3, 1.7);
  const mt = clamp(s.marginTop, 0, 50, 15);
  const mb = clamp(s.marginBottom, 0, 50, 15);
  const ms = clamp(s.marginInlineStart, 0, 50, 12);
  const me = clamp(s.marginInlineEnd, 0, 50, 12);
  const orientation = s.pageOrientation === "landscape" ? "A4 landscape" : "A4 portrait";

  return `
@page { size: ${orientation}; margin: ${mt}mm ${me}mm ${mb}mm ${ms}mm; }
body { font-family: '${font}', sans-serif; color: ${text}; font-size: ${baseSize}px; line-height: ${lineHeight}; text-align: ${align}; }
h1 { font-size: ${titleSize}px; color: ${primary}; }
h2 { font-size: ${Math.max(10, titleSize - 3)}px; color: ${primary}; border-inline-start: 3px ${border} ${primary}; padding-inline-start: 8px; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px ${border} #cfcabc; padding: 5px 7px; text-align: ${align}; vertical-align: top; }
th { background: ${headerBg}1a; font-weight: 700; }
${s.alternatingRows ? "tbody tr:nth-child(even) { background: #faf9f6; }" : ""}
.tpl-watermark { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 64px; color: ${primary}1a; transform: rotate(-30deg); pointer-events: none; }
.tpl-footer { border-top: 1px ${border} #ddd; padding-top: 4px; font-size: ${Math.max(8, baseSize - 3)}px; color: #777; display: flex; justify-content: space-between; }
.tpl-header { border-bottom: 2px ${border} ${primary}; padding-bottom: 8px; margin-bottom: 16px; }
.tpl-logo { max-height: 64px; }
`.trim();
}

/**
 * تصيير وثيقة كاملة من القالب.
 *
 * `bodyHtml` هو المحتوى الذي يولّده مولّد التقرير على الخادم (وهو مهرَّب هناك). كل ما
 * يأتي من إعداد القالب — عناوين ونصوص وتسميات — يمرّ بـ`renderPlaceholders` الذي يهرّب
 * النص والقيمة معاً.
 */
export function renderTemplate(config: TemplateConfig, ctx: RenderContext): string {
  const merged = mergeWithDefaults(config);
  const t = merged.text ?? {};
  const identity = merged.identity ?? {};
  const sig = merged.signature ?? {};
  const style = merged.style ?? {};
  const r = (value: string | undefined) => (value ? renderPlaceholders(value, ctx.values) : "");

  const docNumber = escapeHtml(ctx.values.document_number ?? "");
  const docNumberBlock = docNumber && style.docNumberPosition !== "hidden" ? `<span>رقم الوثيقة: ${docNumber}</span>` : "";
  const inHeader = style.docNumberPosition === "header-start" || style.docNumberPosition === "header-end";

  // D-057: «إدارة التعليم» هي الجهة المخاطَبة — لا سطر للمكتب
  const orgLines = [identity.ministryText, identity.departmentText, identity.schoolName]
    .filter((x): x is string => !!x && x.trim() !== "")
    .map((l) => renderPlaceholders(l, ctx.values))
    .join("<br>");

  /** عنوان القسم — يظهر فقط للأقسام التي تقبل التسمية وللمُسمّاة فعلاً */
  const heading = (label: string | null, renamable: boolean) =>
    renamable && label ? `<h2 class="tpl-section-title">${renderPlaceholders(label, ctx.values)}</h2>` : "";

  const bodyTable = renderTable(config, ctx);

  /** محتوى كل قسم — الأقسام الفارغة لا تُصيَّر حتى لو كانت ظاهرة */
  const sectionHtml: Record<string, string> = {
    header: [
      ctx.logoDataUri ? `<img class="tpl-logo" src="${escapeHtml(ctx.logoDataUri)}" alt="">` : "",
      orgLines ? `<div class="tpl-org">${orgLines}</div>` : "",
      t.headerText ? `<div class="tpl-header-text">${r(t.headerText)}</div>` : "",
      inHeader ? docNumberBlock : "",
    ].join("\n"),
    title: [
      t.titleAr ? `<h1>${r(t.titleAr)}</h1>` : "",
      t.subtitleAr ? `<div class="tpl-subtitle">${r(t.subtitleAr)}</div>` : "",
    ].join("\n"),
    intro: t.introText ? `<p class="tpl-intro">${r(t.introText)}</p>` : "",
    fixed: t.fixedText ? `<p class="tpl-fixed">${r(t.fixedText)}</p>` : "",
    body: [bodyTable, ctx.bodyHtml ?? ""].filter(Boolean).join("\n"),
    closing: t.closingText ? `<p class="tpl-closing">${r(t.closingText)}</p>` : "",
    notes: t.notes ? `<p class="tpl-notes">${r(t.notes)}</p>` : "",
    signature:
      sig.showSignature || sig.showStamp
        ? `<div class="tpl-signatures">
  ${sig.showSignature ? `<div class="tpl-sig">${r(sig.signatureLabel)}</div>` : ""}
  ${sig.showStamp ? `<div class="tpl-approval">${r(sig.approvalLabel)}</div>` : ""}
</div>`
        : "",
    footer: `<span>${t.footerText ? r(t.footerText) : ""}</span>
  ${!inHeader ? docNumberBlock : ""}
  ${style.showPrintDate ? `<span>تاريخ الطباعة: ${escapeHtml(ctx.values.print_date ?? "")}</span>` : ""}
  ${style.showPageNumbers ? `<span class="tpl-page-number"></span>` : ""}`,
  };

  /** غلاف كل قسم — الترويسة والتذييل لهما إطارهما الخاص */
  const wrap = (key: string, inner: string) => {
    if (key === "header") return `<div class="tpl-header">\n${inner}\n</div>`;
    if (key === "footer") return `<div class="tpl-footer">\n${inner}\n</div>`;
    return `<section class="tpl-section tpl-section-${escapeHtml(key)}">\n${inner}\n</section>`;
  };

  const body = resolveSections(merged.sections)
    .filter((s) => s.visible)
    .map((s) => {
      const inner = [heading(s.label, s.def.renamable), sectionHtml[s.key] ?? ""].filter((x) => x.trim() !== "").join("\n");
      // القسم الفارغ لا يترك غلافاً فارغاً في الوثيقة
      if (inner.trim() === "") return "";
      return wrap(s.key, inner);
    })
    .filter((x) => x !== "")
    .join("\n");

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<style>${buildTemplateCss(config)}</style>
</head>
<body>
${t.watermarkText ? `<div class="tpl-watermark">${r(t.watermarkText)}</div>` : ""}
${body}
</body>
</html>`;
}

/**
 * جدول المحتوى — الأعمدة تُرتَّب وتُصفّى وتُسمّى وتُعرَّض بحسب الإعداد (§E2).
 *
 * الأمان: مفاتيح الأعمدة تأتي من سجل النوع المغلق لا من البيانات، والتسميات والقيم
 * تُهرَّب. العرض عدد محصور 5–100 يخرج كنسبة مئوية — لا نص CSS من المستخدم.
 */
function renderTable(config: TemplateConfig, ctx: RenderContext): string {
  if (!ctx.docType || ctx.table === undefined) return "";
  if (columnsFor(ctx.docType).length === 0) return "";

  const columns = resolveColumns(ctx.docType, mergeWithDefaults(config).columns).filter((c) => c.visible);
  if (columns.length === 0) return "";

  const head = columns
    .map((c) => {
      const width = c.width !== null ? ` style="width:${clamp(c.width, 5, 100, 10)}%"` : "";
      return `<th${width}>${renderPlaceholders(c.label, ctx.values)}</th>`;
    })
    .join("");

  const rows = (ctx.table ?? [])
    .map((row) => `<tr>${columns.map((c) => `<td>${cellText(row[c.key])}</td>`).join("")}</tr>`)
    .join("\n");

  return `<table class="tpl-table">
<thead><tr>${head}</tr></thead>
<tbody>
${rows}
</tbody>
</table>`;
}

/** خلية جدول — القيمة الفارغة «—» لا نص فارغ ولا «null» */
function cellText(value: string | number | null | undefined): string {
  if (value === null || value === undefined || String(value).trim() === "") return "—";
  return escapeHtml(value);
}

/**
 * صفوف جدول نموذجية للمعاينة (§E4) — قيم واضحة أنها نموذجية، من سجل الأعمدة نفسه.
 * النوع بلا أعمدة يعيد جدولاً فارغاً فلا يظهر جدول بلا معنى.
 */
export function sampleTable(docType: TemplateDocType): RenderTable {
  const cols = columnsFor(docType);
  if (cols.length === 0) return [];
  return [1, 2, 3].map((n) =>
    Object.fromEntries(cols.map((c) => [c.key, `${c.label} — نموذج ${n}`])),
  );
}

/** بيانات نموذجية للمعاينة (§E4) — لا تلمس سجلات حقيقية ولا تتطلب صلاحية */
export function sampleValues(): Record<string, string> {
  return {
    school_name: "مجمع الخشعة التعليمي للبنين",
    ministry_name: "المملكة العربية السعودية — وزارة التعليم",
    education_department: "إدارة التعليم في محافظة صبيا",
    principal_name: "مدير المجمع",
    academic_year: "1448-1449هـ",
    document_number: "KHS-DOC-00001",
    verification_code: "A1B2C3D4",
    issue_date: "1448/03/02هـ",
    print_date: "1448/03/02هـ",
    program_name: "برنامج نموذجي للمعاينة",
    program_domain: "المجال التعليمي",
    program_owner: "وكيل الشؤون التعليمية",
    program_progress: "75٪",
    closure_date: "1449/01/05هـ",
    closure_note: "اكتمل التنفيذ",
    committee_name: "لجنة نموذجية",
    meeting_date: "1448/03/10هـ",
    meeting_title: "الاجتماع الأول",
    member_list: "عضو أول، عضو ثانٍ، عضو ثالث",
    task_list: "مهمة أولى، مهمة ثانية",
    recommendations: "توصية نموذجية للمعاينة",
    employee_name: "موظف نموذجي",
    evaluation_period: "الفصل الأول",
    financial_total: "10,000",
    total_income: "12,000",
    total_expenses: "2,000",
    cash_balance: "10,000",
  };
}

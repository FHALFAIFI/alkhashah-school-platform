import "server-only";
import { Document, Packer, Paragraph, Table } from "docx";
import {
  approvalArea,
  approvalSpacer,
  metaPara,
  officialDocStyles,
  officialHeaderHeightTwips,
  officialPageMargins,
  officialWordFooter,
  officialWordHeader,
  officialWordTable,
  rtlPara,
  sectionHeading,
  type WordImageAsset,
} from "./word-design";

/**
 * تصدير Word عربي قابل للتحرير — RTL كامل بتصميم الوثيقة الرسمية المعتمد.
 *
 * منذ إعادة تصميم v2.6: البناء بلبنات Word الأصلية المشتركة في `word-design.ts` نفسها
 * التي يستعملها مُصدِّر التقارير المحفوظة — ترويسة Word حقيقية ثلاثية المناطق بالفاصل
 * بلون الهوية، جداول بالتصميم الرسمي (حدود `#cfcabc` وترويسة `#f2f0eb` تتكرر مع كل
 * صفحة)، تذييل حقيقي بترقيم صفحات حي، وخانة اعتماد المدير — نظام بصري واحد لا نظامين.
 */

/** ترويسة رسمية اختيارية — من هوية الوثائق المركزية (v2.3 §8)، لا نص ثابت */
export type WordHeader = {
  orgLines: string[];
  principalName?: string;
  principalTitle?: string;
  academicYear?: string;
  headerNote?: string;
  footerNote?: string;
  contactInfo?: string;
  /** ألوان الهوية (v2.6 §E) — الافتراضي أخضر المنصة الرسمي المعتمد */
  primaryColor?: string;
  accentColor?: string;
  /** الشعارات وأصلا التوقيع والختم محمّلة من التخزين المحلي الآمن — لا جلب شبكي */
  ministryLogo?: WordImageAsset | null;
  schoolLogo?: WordImageAsset | null;
  signature?: WordImageAsset | null;
  stamp?: WordImageAsset | null;
};

/** الألوان الرسمية المعتمدة في `officialPageHtml` — تُستعمل عند غياب هوية مخصصة */
const DEFAULT_PRIMARY = "#1f5244";
const DEFAULT_ACCENT = "#348066";
const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

function safeColor(value: string | undefined, fallback: string): string {
  return value && HEX_COLOR.test(value) ? value : fallback;
}

export async function buildWordReport(opts: {
  title: string;
  meta: [string, string][];
  sections: { heading: string; paragraphs?: string[]; table?: { headers: string[]; rows: string[][] } }[];
  header?: WordHeader;
  /** تاريخ الإصدار لمنطقة الترويسة اليسرى — كما في `officialPageHtml` */
  issuedAtText?: string;
}): Promise<Buffer> {
  const header = opts.header;
  const primary = safeColor(header?.primaryColor, DEFAULT_PRIMARY);
  const accent = safeColor(header?.accentColor, DEFAULT_ACCENT);
  const orgLines = header?.orgLines?.length
    ? header.orgLines
    : ["مجمع الخشعة التعليمي للبنين — منصة الإدارة المدرسية المتكاملة"];

  const headerOpts = {
    orgLines,
    headerNote: header?.headerNote || undefined,
    contactInfo: header?.contactInfo || undefined,
    title: opts.title,
    academicYear: header?.academicYear || undefined,
    metaLines: opts.issuedAtText ? [{ text: `تاريخ الإصدار: ${opts.issuedAtText}` }] : [],
    ministryLogo: header?.ministryLogo ?? null,
    schoolLogo: header?.schoolLogo ?? null,
    primaryColor: primary,
  };
  const wordHeader = officialWordHeader(headerOpts);
  // حجز حزام الترويسة (عيب بوابة fade36f): الهامش العلوي يُحسب من ارتفاع الترويسة
  // المقدَّر فلا يدخل جدولٌ متواصلٌ الترويسةَ على صفحات المتابعة
  const margins = officialPageMargins(officialHeaderHeightTwips(headerOpts), {
    hasFooterText: Boolean(header?.footerNote),
  });

  const children: (Paragraph | Table)[] = [...opts.meta.map(([k, v]) => metaPara(`${k}: ${v}`))];
  for (const s of opts.sections) {
    children.push(sectionHeading(s.heading, primary, accent));
    for (const p of s.paragraphs ?? []) children.push(rtlPara(p));
    if (s.table) {
      children.push(officialWordTable({ header: s.table.headers, rows: s.table.rows, size: 22 }));
    }
  }
  // خانة الاعتماد الرسمية: المسمى ثم الاسم من الهوية المركزية، مع أصلي التوقيع والختم
  // متى فعّلتهما إعدادات الهوية (وإلا بقيت مساحتا التوقيع والختم للتعبئة اليدوية)
  if (header?.principalTitle || header?.principalName) {
    children.push(approvalSpacer());
    children.push(
      approvalArea({
        principalTitle: header.principalTitle || "مدير المدرسة",
        principalName: header.principalName || undefined,
        signature: header.signature ?? null,
        stamp: header.stamp ?? null,
      }),
    );
  }

  const doc = new Document({
    // D-040: خط عربي مطابق لخط PDF المضمن — وورد يستبدل تلقائياً إن لم يكن مثبتاً
    styles: officialDocStyles(primary),
    sections: [
      {
        properties: {
          page: { margin: margins },
        },
        headers: { default: wordHeader },
        footers: { default: officialWordFooter(header?.footerNote ?? "") },
        children,
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

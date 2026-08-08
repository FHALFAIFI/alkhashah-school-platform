import "server-only";
import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageBreak,
  PageNumber,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertMillimetersToTwip,
} from "docx";
import type { SnapshotDoc, SnapshotSection, SnapshotColumn } from "./options";
import type { StyleConfig } from "./base-templates";
import { cellText, splitColumns, styleOf, tableLayoutFor, wantsCover, wantsToc } from "./render";

/**
 * تصدير التقرير المحفوظ إلى Word قابل للتحرير (v2.6 §F/§G).
 *
 * المصدر هو `SnapshotDoc` المجمّد نفسه الذي يغذّي HTML/PDF — تطابق مصدرٍ لا تطابق
 * اجتهاد. القواعد نفسها تُعاد هنا بلغة Word:
 *  - RTL كامل: كل فقرة `bidirectional`، كل نص `rightToLeft`، كل جدول
 *    `visuallyRightToLeft`، والخط الافتراضي «IBM Plex Sans Arabic» (D-040 — وورد
 *    يستبدل تلقائياً إن لم يكن مثبتاً).
 *  - الترويسة والتذييل ترويسة وتذييل Word حقيقيان قابلان للتحرير — لا فقرات مكررة
 *    في المتن.
 *  - الجدول العريض يُدار بقرار `tableLayoutFor` ذاته: القسم الأفقي يُخرَج مقطع Word
 *    مستقلاً بصفحة A4 أفقية، وفوق 18 عموداً يُقسَّم بمجموعات مع تكرار العمود الأول.
 *  - ترويسة الجدول تتكرر مع كل صفحة (`tableHeader`) والصف لا ينقسم (`cantSplit`).
 */

/* ─────────────────── لبنات RTL أساسية ─────────────────── */

const META_COLOR = "555555";
const META_SIZE = 18; // بأنصاف النقاط: 9pt

function rtlPara(text: string, opts: { bold?: boolean; size?: number; color?: string } = {}): Paragraph {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    children: [new TextRun({ text, rightToLeft: true, bold: opts.bold, size: opts.size, color: opts.color })],
  });
}

/** سطر وصفي صغير رمادي — مرشّحات وعدّادات، يقابل `.meta` في المصيّر HTML */
function metaPara(text: string): Paragraph {
  return rtlPara(text, { size: META_SIZE, color: META_COLOR });
}

function centeredPara(text: string, opts: { bold?: boolean; size?: number; color?: string } = {}): Paragraph {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text, rightToLeft: true, bold: opts.bold, size: opts.size, color: opts.color })],
  });
}

function rtlHeading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    children: [new TextRun({ text, rightToLeft: true })],
  });
}

function pageBreakPara(): Paragraph {
  return new Paragraph({ children: [new PageBreak()] });
}

/** لون docx بلا علامة `#` — المخطط الصارم يضمن hex فلا حاجة لأكثر من القصّ */
function docxColor(cssHex: string): string {
  return cssHex.replace("#", "");
}

/* ─────────────────── الترويسة والتذييل — Word حقيقيان ─────────────────── */

function buildHeader(doc: SnapshotDoc, style: StyleConfig, reportNumber: string | null | undefined): Header {
  const children: Paragraph[] = [];
  if (style.showIdentity) {
    doc.identity.orgLines.forEach((line, i) => {
      children.push(centeredPara(line, { bold: i === doc.identity.orgLines.length - 1, size: 18 }));
    });
    const headerNote = style.headerText || doc.identity.headerNote;
    if (headerNote) children.push(centeredPara(headerNote, { size: 18, color: META_COLOR }));
  }
  children.push(centeredPara(doc.title, { bold: true, size: 24, color: docxColor(style.primaryColor) }));
  if (reportNumber) children.push(centeredPara(`رقم التقرير: ${reportNumber}`, { size: 18 }));
  return new Header({ children });
}

function buildFooter(footerText: string): Footer {
  const children: Paragraph[] = [];
  if (footerText) children.push(centeredPara(footerText, { size: META_SIZE, color: META_COLOR }));
  // ترقيم الصفحات بحقلي PAGE/NUMPAGES — يتحدّث في وورد مع كل إعادة تصفيح
  children.push(
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: "صفحة ", rightToLeft: true, size: META_SIZE, color: META_COLOR }),
        new TextRun({ children: [PageNumber.CURRENT], size: META_SIZE, color: META_COLOR }),
        new TextRun({ text: " من ", rightToLeft: true, size: META_SIZE, color: META_COLOR }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], size: META_SIZE, color: META_COLOR }),
      ],
    }),
  );
  return new Footer({ children });
}

/* ─────────────────── الغلاف والفهرس ─────────────────── */

function coverChildren(doc: SnapshotDoc, style: StyleConfig, reportNumber: string | null | undefined): Paragraph[] {
  const out: Paragraph[] = [];
  if (style.showIdentity) {
    doc.identity.orgLines.forEach((line, i) => {
      out.push(centeredPara(line, { bold: i === doc.identity.orgLines.length - 1 }));
    });
  }
  out.push(
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { before: 2400, after: 600 },
      children: [new TextRun({ text: doc.title, rightToLeft: true, bold: true, size: 52, color: docxColor(style.primaryColor) })],
    }),
  );
  out.push(centeredPara(doc.typeLabel));
  if (doc.periodText) out.push(centeredPara(`الفترة: ${doc.periodText}`));
  if (reportNumber) out.push(centeredPara(`رقم التقرير: ${reportNumber}`, { bold: true }));
  out.push(centeredPara(`تاريخ الإصدار: ${doc.generatedAtText}`));
  if (style.showIdentity && doc.identity.academicYear) out.push(centeredPara(`العام الدراسي: ${doc.identity.academicYear}`));
  out.push(pageBreakPara());
  return out;
}

/**
 * الفهرس قائمة ثابتة مرقّمة لا حقل `TableOfContents` عمداً: اللقطة مجمّدة فالقائمة لا
 * يمكن أن تنحرف عن المحتوى، والحقل يطالب المستخدم بتحديث الحقول عند كل فتح للملف —
 * سلوك غير حتمي بلا مقابل. (القائمة تطابق فهرس HTML: أقسام اللقطة بترتيبها.)
 */
function tocChildren(doc: SnapshotDoc): Paragraph[] {
  return [
    rtlHeading("المحتويات"),
    ...doc.sections.map((s, i) => rtlPara(`${i + 1}. ${s.label}`)),
    pageBreakPara(),
  ];
}

/* ─────────────────── جداول البيانات ─────────────────── */

function tableCellPara(text: string, opts: { bold?: boolean; size: number }): Paragraph {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    children: [new TextRun({ text, rightToLeft: true, bold: opts.bold, size: opts.size })],
  });
}

function dataTable(
  cols: SnapshotColumn[],
  rows: SnapshotSection["rows"],
  fontScale: number,
): Table {
  // حجم الجدول بأنصاف النقاط من معامل التصغير المحكوم نفسه المستعمل في HTML/PDF
  const size = Math.round(22 * fontScale);
  return new Table({
    visuallyRightToLeft: true,
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      // ترويسة الجدول تتكرر أعلى كل صفحة جديدة (§F)
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: cols.map(
          (c) =>
            new TableCell({
              shading: { fill: "F2F0EB" },
              children: [tableCellPara(c.label, { bold: true, size })],
            }),
        ),
      }),
      ...rows.map(
        (r) =>
          new TableRow({
            cantSplit: true,
            children: cols.map(
              (c) => new TableCell({ children: [tableCellPara(cellText(r[c.key], c.type), { size })] }),
            ),
          }),
      ),
    ],
  });
}

function sectionChildren(section: SnapshotSection, index: number, layoutFontScale: number, splitAt: number | null): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [rtlHeading(`${index + 1}. ${section.label}`)];
  if (section.filterLines.length) {
    out.push(metaPara(section.filterLines.map(([k, v]) => `${k}: ${v}`).join(" · ")));
  }
  out.push(metaPara(`عدد الصفوف: ${section.total}`));
  if (section.truncated) {
    out.push(rtlPara("اقتُطع القسم عند حدّه الأقصى — ضيّق المرشّحات ليكتمل.", { size: META_SIZE, color: "8A6D00" }));
  }
  if (section.empty) {
    out.push(metaPara("لا بيانات مطابقة للمرشّحات في هذا القسم."));
    return out;
  }
  const groups = splitAt ? splitColumns(section.columns, splitAt) : [section.columns];
  groups.forEach((cols, gi) => {
    if (groups.length > 1) out.push(metaPara(`جزء ${gi + 1} من ${groups.length} — العمود الأول مكرر للربط`));
    out.push(dataTable(cols, section.rows, layoutFontScale));
  });
  return out;
}

function attachmentsChildren(doc: SnapshotDoc): (Paragraph | Table)[] {
  return [
    rtlHeading(`${doc.sections.length + 1}. الشواهد والمرفقات المستعملة`),
    dataTable(
      [
        { key: "n", label: "م" },
        { key: "name", label: "المرفق" },
        { key: "source", label: "المصدر" },
      ],
      doc.attachments.map((a, i) => ({ n: i + 1, name: a.name, source: a.source })),
      1,
    ),
  ];
}

/** خانة الاعتماد والتوقيع في ذيل التقرير — المسمى ثم الاسم من هوية اللقطة */
function approvalChildren(doc: SnapshotDoc): Paragraph[] {
  const out: Paragraph[] = [rtlPara("")];
  out.push(rtlPara(doc.identity.principalTitle || "مدير المدرسة", { bold: true }));
  if (doc.identity.principalName) out.push(rtlPara(doc.identity.principalName, { bold: true }));
  out.push(rtlPara("التوقيع: ................................"));
  out.push(rtlPara("الختم: ................................"));
  return out;
}

/* ─────────────────── التجميع — مقاطع Word باتجاهات مختلطة ─────────────────── */

type Bucket = { orientation: "portrait" | "landscape"; children: (Paragraph | Table)[] };

export async function instanceDocx(doc: SnapshotDoc, opts: { reportNumber?: string | null }): Promise<Buffer> {
  const style = styleOf(doc);
  const reportNumber = opts.reportNumber ?? null;

  const front: (Paragraph | Table)[] = [];
  // ختم المسودة: التقرير غير المعتمد لا يُشبه وثيقة صادرة (يقابل `.draft-stamp` في HTML)
  if (!reportNumber) {
    front.push(centeredPara("مسودة — غير معتمدة", { bold: true, size: 36, color: "B42828" }));
  }
  if (wantsCover(doc, style)) front.push(...coverChildren(doc, style, reportNumber));
  if (wantsToc(doc, style)) front.push(...tocChildren(doc));

  // كل تتابُع أقسام بالاتجاه نفسه يُجمع في مقطع Word واحد؛ تغيّر الاتجاه يفتح مقطعاً
  // جديداً بحجم صفحته — القسم العريض أفقي والباقي رأسي، لا قصّ صامتاً أبداً (§F)
  const buckets: Bucket[] = [{ orientation: "portrait", children: front }];
  doc.sections.forEach((section, i) => {
    const layout = tableLayoutFor(section.columns.length);
    const last = buckets[buckets.length - 1];
    if (layout.orientation !== last.orientation) {
      if (last.children.length === 0) last.orientation = layout.orientation;
      else buckets.push({ orientation: layout.orientation, children: [] });
    }
    buckets[buckets.length - 1].children.push(...sectionChildren(section, i, layout.fontScale, layout.splitAt));
  });

  // الذيل — المرفقات ثم الاعتماد — رأسي دائماً كما في المصيّر HTML
  const tail: (Paragraph | Table)[] = [];
  if (doc.attachments.length) tail.push(...attachmentsChildren(doc));
  if (style.approvalBox) tail.push(...approvalChildren(doc));
  if (tail.length) {
    const last = buckets[buckets.length - 1];
    if (last.orientation === "portrait") last.children.push(...tail);
    else buckets.push({ orientation: "portrait", children: tail });
  }

  const header = buildHeader(doc, style, reportNumber);
  const footerText = style.footerText || (style.showIdentity ? doc.identity.footerNote : "");
  const footer = buildFooter(footerText);

  const word = new Document({
    styles: {
      default: {
        // D-040: خط عربي مطابق لخط PDF المضمن — وورد يستبدل تلقائياً إن لم يكن مثبتاً
        document: { run: { font: "IBM Plex Sans Arabic", size: 22, rightToLeft: true } },
      },
    },
    sections: buckets.map((bucket, i) => ({
      properties: {
        page: {
          size: {
            orientation: bucket.orientation === "landscape" ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
          },
          margin: {
            top: convertMillimetersToTwip(15),
            bottom: convertMillimetersToTwip(15),
            left: convertMillimetersToTwip(12),
            right: convertMillimetersToTwip(12),
          },
        },
      },
      // الترويسة والتذييل على المقطع الأول فقط — بقية المقاطع ترثهما بدلالة OOXML
      ...(i === 0 ? { headers: { default: header }, footers: { default: footer } } : {}),
      children: bucket.children,
    })),
  });

  return Buffer.from(await Packer.toBuffer(word));
}

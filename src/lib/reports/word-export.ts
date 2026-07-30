import "server-only";
import {
  Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, HeadingLevel, WidthType, AlignmentType,
} from "docx";

/**
 * تصدير Word عربي قابل للتحرير — RTL كامل.
 */

function rtlHeading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]): Paragraph {
  return new Paragraph({
    heading: level,
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    children: [new TextRun({ text, rightToLeft: true })],
  });
}

function rtlPara(text: string, bold = false): Paragraph {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    children: [new TextRun({ text, bold, rightToLeft: true })],
  });
}

function rtlTable(headers: string[], rows: string[][]): Table {
  return new Table({
    visuallyRightToLeft: true,
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: headers.map(
          (h) =>
            new TableCell({
              children: [rtlPara(h, true)],
            }),
        ),
      }),
      ...rows.map(
        (r) =>
          new TableRow({
            children: r.map((c) => new TableCell({ children: [rtlPara(c)] })),
          }),
      ),
    ],
  });
}

/** ترويسة رسمية اختيارية — من هوية الوثائق المركزية (v2.3 §8)، لا نص ثابت */
export type WordHeader = {
  orgLines: string[];
  principalName?: string;
  principalTitle?: string;
  academicYear?: string;
  footerNote?: string;
};

export async function buildWordReport(opts: {
  title: string;
  meta: [string, string][];
  sections: { heading: string; paragraphs?: string[]; table?: { headers: string[]; rows: string[][] } }[];
  header?: WordHeader;
}): Promise<Buffer> {
  const headerLines = opts.header?.orgLines?.length
    ? opts.header.orgLines
    : ["مجمع الخشعة التعليمي للبنين — منصة الإدارة المدرسية المتكاملة"];
  const children: (Paragraph | Table)[] = [
    ...headerLines.map((l, i) =>
      rtlHeading(l, i === headerLines.length - 1 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3),
    ),
    ...(opts.header?.academicYear ? [rtlPara(`العام الدراسي: ${opts.header.academicYear}`)] : []),
    rtlHeading(opts.title, HeadingLevel.HEADING_1),
    ...opts.meta.map(([k, v]) => rtlPara(`${k}: ${v}`)),
  ];
  for (const s of opts.sections) {
    children.push(rtlHeading(s.heading, HeadingLevel.HEADING_2));
    for (const p of s.paragraphs ?? []) children.push(rtlPara(p));
    if (s.table) children.push(rtlTable(s.table.headers, s.table.rows));
  }
  // خانة التوقيع الرسمية: المسمى ثم الاسم من الهوية المركزية
  if (opts.header?.principalTitle || opts.header?.principalName) {
    children.push(rtlPara(""));
    if (opts.header.principalTitle) children.push(rtlPara(opts.header.principalTitle, true));
    if (opts.header.principalName) children.push(rtlPara(opts.header.principalName, true));
    children.push(rtlPara("التوقيع: ................................"));
  }
  if (opts.header?.footerNote) children.push(rtlPara(opts.header.footerNote));
  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: "Arial", size: 22, rightToLeft: true } },
      },
    },
    sections: [{ properties: {}, children }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

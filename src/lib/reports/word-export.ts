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

export async function buildWordReport(opts: {
  title: string;
  meta: [string, string][];
  sections: { heading: string; paragraphs?: string[]; table?: { headers: string[]; rows: string[][] } }[];
}): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    rtlHeading("مجمع الخشعة التعليمي للبنين — منصة الإدارة المدرسية المتكاملة", HeadingLevel.HEADING_2),
    rtlHeading(opts.title, HeadingLevel.HEADING_1),
    ...opts.meta.map(([k, v]) => rtlPara(`${k}: ${v}`)),
  ];
  for (const s of opts.sections) {
    children.push(rtlHeading(s.heading, HeadingLevel.HEADING_2));
    for (const p of s.paragraphs ?? []) children.push(rtlPara(p));
    if (s.table) children.push(rtlTable(s.table.headers, s.table.rows));
  }
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

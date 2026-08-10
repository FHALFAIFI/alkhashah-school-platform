import "server-only";
import {
  AlignmentType,
  BorderStyle,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import { readStoredFile } from "@/lib/storage";

/**
 * Shared native-Word design primitives for every DOCX export path.
 *
 * This is the Word translation of the established official document design of
 * `officialPageHtml` (src/lib/pdf.ts) and the v2.6 instance renderer
 * (src/lib/reports/instances/render.ts): the three-zone RTL header with the
 * ministry identity on the right, the title centrally and the document meta +
 * school logo on the left, a primary-color separator, dark-green section
 * headings with an accent side rule, bordered tables with the neutral header
 * fill, the official footer with live page numbering, and the principal
 * approval area. Both the legacy registry Word export (word-export.ts) and the
 * v2.6 report-instance export (instances/export-docx.ts) build on these
 * primitives so there is exactly one visual system.
 *
 * Everything is native, editable Word structure — no screenshots, no external
 * relationships, no network access. Logos are read only through the secure
 * local storage layer and embedded as `ImageRun` binary parts; a missing or
 * unreadable logo silently falls back to the text identity.
 */

/* ─────────────────── Design constants (match the official CSS) ─────────────────── */

/** Table grid color — the established `#cfcabc` of th/td borders. */
export const TABLE_BORDER_COLOR = "CFCABC";
/** Table header-row fill — the established `#f2f0eb`. */
export const TABLE_HEADER_FILL = "F2F0EB";
/** Meta text color — the established `.meta` `#555`. */
export const META_COLOR = "555555";
/** Footer text color — the established `.footer` `#777`. */
export const FOOTER_COLOR = "777777";
/** Footer separator color — the established `border-top: 1px solid #ddd`. */
export const FOOTER_RULE_COLOR = "DDDDDD";
/** Signature line color — the established `.sig-line` `#999`. */
export const SIG_LINE_COLOR = "999999";
/** Meta font size in half-points (≈ the 10px meta text of the HTML design). */
export const META_SIZE = 16;

/**
 * Primary document font. Word substitutes a shaped Arabic system font
 * automatically on machines where IBM Plex Sans Arabic is not installed
 * (D-040) — that substitution mechanism is Word's own fallback declaration.
 */
export const DOC_FONT = "IBM Plex Sans Arabic";

/** docx wants hex colors without the leading `#`. */
export function docxColor(cssHex: string): string {
  return cssHex.replace("#", "");
}

/**
 * Document-level styles: default RTL run + official heading colors, so the
 * cover title (Heading 1) and section headings (Heading 2) carry the identity
 * primary color instead of Word's default blue theme headings.
 */
export function officialDocStyles(primaryColor: string) {
  const color = docxColor(primaryColor);
  return {
    default: {
      document: { run: { font: DOC_FONT, size: 22, rightToLeft: true } },
      heading1: {
        run: { font: DOC_FONT, size: 32, bold: true, color },
        paragraph: { spacing: { before: 240, after: 120 } },
      },
      heading2: {
        run: { font: DOC_FONT, size: 24, bold: true, color },
        paragraph: { spacing: { before: 240, after: 120 } },
      },
    },
  };
}

/* ─────────────────── Basic RTL building blocks ─────────────────── */

export type RunStyle = { bold?: boolean; size?: number; color?: string };

export function rtlPara(text: string, opts: RunStyle = {}): Paragraph {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    children: [new TextRun({ text, rightToLeft: true, bold: opts.bold, size: opts.size, color: opts.color })],
  });
}

/** Small gray descriptive line — filters and counters, mirrors `.meta`. */
export function metaPara(text: string): Paragraph {
  return rtlPara(text, { size: META_SIZE, color: META_COLOR });
}

export function centeredPara(text: string, opts: RunStyle = {}): Paragraph {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text, rightToLeft: true, bold: opts.bold, size: opts.size, color: opts.color })],
  });
}

/**
 * Section heading in the official design: primary-color bold text with the
 * accent rule on the start (right, RTL) side — the Word translation of
 * `h2 { color: primary; border-inline-start: 3px solid accent }`.
 * Kept as a real Heading 2 so the document stays navigable and editable.
 */
export function sectionHeading(text: string, primaryColor: string, accentColor: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    keepNext: true,
    border: {
      right: { style: BorderStyle.SINGLE, size: 24, color: docxColor(accentColor), space: 4 },
    },
    children: [new TextRun({ text, rightToLeft: true, bold: true, size: 24, color: docxColor(primaryColor) })],
  });
}

/* ─────────────────── Embedded images (logos / signature / stamp) ─────────────────── */

export type WordImageAsset = {
  data: Buffer;
  type: "png" | "jpg";
  /** Intrinsic pixel size — needed to preserve aspect ratio when fitting. */
  width: number;
  height: number;
};

function pngDimensions(data: Buffer): { width: number; height: number } | null {
  if (data.length < 24) return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function jpgDimensions(data: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < data.length) {
    if (data[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = data[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    const length = data.readUInt16BE(i + 2);
    if (length < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 9 > data.length) return null;
      return { height: data.readUInt16BE(i + 5), width: data.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPG_MAGIC = [0xff, 0xd8, 0xff];

/**
 * Turn a raw stored image into an embeddable Word asset. Only PNG and JPEG can
 * be embedded natively; anything else (WebP, corrupt data, absurd dimensions)
 * returns null and the caller keeps the text identity — a bad logo must never
 * block document generation.
 */
export function toWordImageAsset(data: Buffer, mime: string): WordImageAsset | null {
  const magicMatches = (magic: number[]) => data.length >= magic.length && magic.every((b, i) => data[i] === b);
  let type: "png" | "jpg";
  if (mime === "image/png" && magicMatches(PNG_MAGIC)) type = "png";
  else if (mime === "image/jpeg" && magicMatches(JPG_MAGIC)) type = "jpg";
  else return null;
  const dims = type === "png" ? pngDimensions(data) : jpgDimensions(data);
  if (!dims || dims.width <= 0 || dims.height <= 0 || dims.width > 20000 || dims.height > 20000) return null;
  return { data, type, width: dims.width, height: dims.height };
}

/**
 * Load a stored file (secure local storage only — never the network) as an
 * embeddable image asset. Any failure degrades to null, never throws.
 */
export async function loadWordImageAsset(fileId: string | null | undefined): Promise<WordImageAsset | null> {
  if (!fileId) return null;
  try {
    const stored = await readStoredFile(fileId);
    if (!stored) return null;
    return toWordImageAsset(stored.data, stored.file.mime);
  } catch {
    return null;
  }
}

/**
 * Shrink-only aspect-ratio fit into a bounding box, mirroring the CSS
 * `max-width/max-height + object-fit: contain` treatment of the logos.
 */
export function fitImage(asset: WordImageAsset, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / asset.width, maxHeight / asset.height);
  return { width: Math.max(1, Math.round(asset.width * scale)), height: Math.max(1, Math.round(asset.height * scale)) };
}

function imagePara(asset: WordImageAsset, maxWidth: number, maxHeight: number, altText: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new ImageRun({
        type: asset.type,
        data: asset.data,
        transformation: fitImage(asset, maxWidth, maxHeight),
        altText: { title: altText, description: altText, name: altText },
      }),
    ],
  });
}

/* ─────────────────── The official three-zone header ─────────────────── */

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "auto" } as const;
const CELL_NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER } as const;

function zoneCell(widthPct: number, children: Paragraph[]): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.TOP,
    borders: CELL_NO_BORDERS,
    children,
  });
}

/** The primary-color rule below the header — `border-bottom: 2px solid primary`. */
function headerSeparator(primaryColor: string): Paragraph {
  return new Paragraph({
    spacing: { before: 40, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: docxColor(primaryColor), space: 2 } },
    children: [],
  });
}

export type OfficialHeaderOptions = {
  /** Organization lines, top to bottom; the last line (school name) is bold. */
  orgLines: string[];
  headerNote?: string;
  contactInfo?: string;
  /** Central zone: document title in the primary color. */
  title: string;
  /** Central zone meta line under the title (type label, period…). */
  subtitle?: string;
  /** Central zone academic-year line (officialPageHtml puts the year centrally). */
  academicYear?: string;
  /** Left zone lines: document/report number, issue date… `[label, value, bold?]`. */
  metaLines: { text: string; bold?: boolean }[];
  ministryLogo?: WordImageAsset | null;
  schoolLogo?: WordImageAsset | null;
  primaryColor: string;
};

/**
 * The official three-zone RTL header as a real, editable Word header:
 * right = ministry logo + organization lines, center = title + identity/year,
 * left = document meta + school logo, all above the primary-color separator.
 * Built as a borderless table so the zones keep their placement in Microsoft
 * Word across portrait and landscape sections (percentage widths follow the
 * text column). Defined once on the first section; later sections inherit it
 * by OOXML semantics, so it repeats on every page without body duplication.
 */
export function officialWordHeader(opts: OfficialHeaderOptions): Header {
  const orgChildren: Paragraph[] = opts.orgLines.map((line, i) =>
    rtlPara(line, { bold: i === opts.orgLines.length - 1, size: META_SIZE }),
  );
  if (opts.headerNote) orgChildren.push(rtlPara(opts.headerNote, { size: META_SIZE, color: META_COLOR }));
  if (opts.contactInfo) orgChildren.push(rtlPara(opts.contactInfo, { size: META_SIZE, color: META_COLOR }));

  const centerChildren: Paragraph[] = [centeredPara(opts.title, { bold: true, size: 24, color: docxColor(opts.primaryColor) })];
  if (opts.subtitle) centerChildren.push(centeredPara(opts.subtitle, { size: META_SIZE, color: META_COLOR }));
  if (opts.academicYear) {
    centerChildren.push(centeredPara(`العام الدراسي: ${opts.academicYear}`, { size: META_SIZE, color: META_COLOR }));
  }

  const metaChildren: Paragraph[] = opts.metaLines.map((line) =>
    rtlPara(line.text, { size: META_SIZE, color: META_COLOR, bold: line.bold }),
  );

  // Visual order right → left in the RTL table: ministry logo, org, title, meta, school logo.
  const cells: TableCell[] = [];
  const logoPct = 12;
  const hasMinistryLogo = Boolean(opts.ministryLogo);
  const hasSchoolLogo = Boolean(opts.schoolLogo);
  const sidePct = (100 - 30 - (hasMinistryLogo ? logoPct : 0) - (hasSchoolLogo ? logoPct : 0)) / 2;
  if (opts.ministryLogo) {
    cells.push(zoneCell(logoPct, [imagePara(opts.ministryLogo, 90, 58, "شعار وزارة التعليم")]));
  }
  cells.push(zoneCell(sidePct, orgChildren));
  cells.push(zoneCell(30, centerChildren));
  cells.push(zoneCell(sidePct, metaChildren));
  if (opts.schoolLogo) {
    cells.push(zoneCell(logoPct, [imagePara(opts.schoolLogo, 90, 58, "شعار المدرسة")]));
  }

  return new Header({
    children: [
      new Table({
        visuallyRightToLeft: true,
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [new TableRow({ children: cells })],
      }),
      headerSeparator(opts.primaryColor),
    ],
  });
}

/**
 * The clean identity-free header of the «بلا هوية» template: centered title
 * and meta above the separator — no organization block, no logos.
 */
export function plainWordHeader(opts: { title: string; metaLines: string[]; primaryColor: string }): Header {
  return new Header({
    children: [
      centeredPara(opts.title, { bold: true, size: 24, color: docxColor(opts.primaryColor) }),
      ...opts.metaLines.map((line) => centeredPara(line, { size: META_SIZE, color: META_COLOR })),
      headerSeparator(opts.primaryColor),
    ],
  });
}

/* ─────────────────── The official footer ─────────────────── */

/**
 * Real Word footer: restrained top rule, configured footer text, and live
 * PAGE/NUMPAGES fields that Word repaginates itself.
 */
export function officialWordFooter(footerText: string): Footer {
  const children: Paragraph[] = [];
  const rule = { top: { style: BorderStyle.SINGLE, size: 4, color: FOOTER_RULE_COLOR, space: 2 } } as const;
  if (footerText) {
    children.push(
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.CENTER,
        border: rule,
        children: [new TextRun({ text: footerText, rightToLeft: true, size: META_SIZE, color: FOOTER_COLOR })],
      }),
    );
  }
  children.push(
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      ...(footerText ? {} : { border: rule }),
      children: [
        new TextRun({ text: "صفحة ", rightToLeft: true, size: META_SIZE, color: FOOTER_COLOR }),
        new TextRun({ children: [PageNumber.CURRENT], size: META_SIZE, color: FOOTER_COLOR }),
        new TextRun({ text: " من ", rightToLeft: true, size: META_SIZE, color: FOOTER_COLOR }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], size: META_SIZE, color: FOOTER_COLOR }),
      ],
    }),
  );
  return new Footer({ children });
}

/* ─────────────────── The official data table ─────────────────── */

const GRID_BORDER = { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER_COLOR } as const;

export type OfficialTableOptions = {
  /** Header labels, right to left as the columns should appear. */
  header: string[];
  /** Body rows of pre-formatted display strings. */
  rows: string[][];
  /** Body font size in half-points (already density/scale-adjusted). */
  size: number;
  /** Table density — controls the native cell margins (HTML padding parity). */
  density?: "عادي" | "مضغوط";
};

function officialCellPara(text: string, opts: { bold?: boolean; size: number }): Paragraph {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    children: [new TextRun({ text, rightToLeft: true, bold: opts.bold, size: opts.size })],
  });
}

/**
 * Full-width RTL table in the official design: visible `#cfcabc` grid,
 * `#f2f0eb` bold header row that repeats on every page, comfortable native
 * cell margins (the Word twin of the established HTML padding), top vertical
 * alignment, right-aligned content, and rows that never split across pages.
 */
export function officialWordTable(opts: OfficialTableOptions): Table {
  const compact = opts.density === "مضغوط";
  // HTML padding 5px 7px (compact 3px 5px) → twips at 15 twips/px.
  const margins = compact
    ? { top: 45, bottom: 45, left: 75, right: 75 }
    : { top: 75, bottom: 75, left: 105, right: 105 };
  return new Table({
    visuallyRightToLeft: true,
    width: { size: 100, type: WidthType.PERCENTAGE },
    // Content-based column sizing — the Word twin of the HTML auto table layout;
    // fixed even distribution over-wraps long Arabic names in narrow columns.
    layout: TableLayoutType.AUTOFIT,
    margins,
    borders: {
      top: GRID_BORDER,
      bottom: GRID_BORDER,
      left: GRID_BORDER,
      right: GRID_BORDER,
      insideHorizontal: GRID_BORDER,
      insideVertical: GRID_BORDER,
    },
    rows: [
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: opts.header.map(
          (label) =>
            new TableCell({
              shading: { fill: TABLE_HEADER_FILL },
              verticalAlign: VerticalAlign.TOP,
              children: [officialCellPara(label, { bold: true, size: opts.size })],
            }),
        ),
      }),
      ...opts.rows.map(
        (row) =>
          new TableRow({
            cantSplit: true,
            children: row.map(
              (cell) =>
                new TableCell({
                  verticalAlign: VerticalAlign.TOP,
                  children: [officialCellPara(cell, { size: opts.size })],
                }),
            ),
          }),
      ),
    ],
  });
}

/* ─────────────────── The principal approval area ─────────────────── */

export type ApprovalAreaOptions = {
  principalTitle: string;
  principalName?: string;
  /** Stored private signature image — dotted signing space when absent. */
  signature?: WordImageAsset | null;
  /** Stored private stamp image — labeled stamp space when absent. */
  stamp?: WordImageAsset | null;
};

/**
 * The clean principal approval area of the official design: a stable
 * borderless two-block layout — signature block (image or signing space above
 * the `#999` line carrying the principal title and name, then the date line)
 * on the right, the school stamp block on the left. Principal-level fields
 * only; never employee or teacher blocks.
 */
export function approvalArea(opts: ApprovalAreaOptions): Table {
  const sigLine = { top: { style: BorderStyle.SINGLE, size: 4, color: SIG_LINE_COLOR, space: 4 } } as const;
  const signatureChildren: Paragraph[] = [];
  if (opts.signature) {
    signatureChildren.push(imagePara(opts.signature, 180, 60, "توقيع مدير المدرسة"));
  } else {
    // Blank hand-signing space above the line (the 44px sig-line offset).
    signatureChildren.push(new Paragraph({ spacing: { before: 640 }, children: [] }));
  }
  signatureChildren.push(
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      border: sigLine,
      children: [new TextRun({ text: opts.principalTitle, rightToLeft: true, bold: true, size: 22 })],
    }),
  );
  if (opts.principalName) signatureChildren.push(centeredPara(opts.principalName, { bold: true, size: 22 }));
  signatureChildren.push(centeredPara("التاريخ: ......................", { size: META_SIZE, color: META_COLOR }));

  const stampChildren: Paragraph[] = [];
  if (opts.stamp) {
    stampChildren.push(imagePara(opts.stamp, 120, 90, "ختم المدرسة"));
  } else {
    stampChildren.push(new Paragraph({ spacing: { before: 640 }, children: [] }));
  }
  stampChildren.push(
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      border: sigLine,
      children: [new TextRun({ text: "الختم", rightToLeft: true, size: 22 })],
    }),
  );

  return new Table({
    visuallyRightToLeft: true,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: NO_BORDER,
      bottom: NO_BORDER,
      left: NO_BORDER,
      right: NO_BORDER,
      insideHorizontal: NO_BORDER,
      insideVertical: NO_BORDER,
    },
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          zoneCell(40, signatureChildren),
          zoneCell(20, [new Paragraph({ children: [] })]),
          zoneCell(40, stampChildren),
        ],
      }),
    ],
  });
}

/** Spacer above the approval area — the `.signatures { margin-top: 32px }`. */
export function approvalSpacer(): Paragraph {
  return new Paragraph({ spacing: { before: 480 }, children: [] });
}

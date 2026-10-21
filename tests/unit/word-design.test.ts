import { describe, it, expect } from "vitest";
import AdmZip from "adm-zip";
import { convertMillimetersToTwip } from "docx";
import { buildInstanceDocx, instanceDocx } from "@/lib/reports/instances/export-docx";
import { buildWordReport } from "@/lib/reports/word-export";
import {
  fitImage,
  officialHeaderHeightTwips,
  toWordImageAsset,
  HEADER_DISTANCE_TWIPS,
} from "@/lib/reports/word-design";
import { BASE_TEMPLATES, baseTemplateByKey } from "@/lib/reports/instances/base-templates";
import type { SnapshotDoc, SnapshotSection, SnapshotColumn } from "@/lib/reports/instances/options";

/**
 * v2.6 Word design gate — deterministic validation of the official document
 * design in native Word structures (shared primitives in word-design.ts):
 * three-zone RTL header with embedded logos, primary/accent identity colors,
 * official table grid/fill/margins, real footer with live page fields, and the
 * principal approval area — across both DOCX paths (instance + legacy registry)
 * and all five base templates. No external relationships, ever.
 */

/* ─────────────────── fixtures ─────────────────── */

// Real minimal images: a 1×1 PNG and a 1×1 JPEG (binary-valid, parseable dims).
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const JPG_1PX = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==",
  "base64",
);

const pngAsset = () => toWordImageAsset(PNG_1PX, "image/png")!;
const jpgAsset = () => toWordImageAsset(JPG_1PX, "image/jpeg")!;

const officialConfig = baseTemplateByKey("official")!.config;

const portraitSection: SnapshotSection = {
  key: "programs",
  reportKey: "programs-active",
  label: "سجل البرامج",
  columns: [
    { key: "name", label: "البرنامج" },
    { key: "owner", label: "المسؤول" },
  ],
  rows: [{ name: "برنامج القراءة", owner: "المعلم الأول" }],
  total: 1,
  truncated: false,
  filterLines: [],
  empty: false,
};

const wideColumns: SnapshotColumn[] = [
  { key: "kpi", label: "المؤشر" },
  ...Array.from({ length: 11 }, (_, i) => ({ key: `m${i}`, label: `قياس ${i + 1}` })),
];
const landscapeSection: SnapshotSection = {
  key: "matrix",
  reportKey: "kpi-matrix",
  label: "مصفوفة المؤشرات",
  columns: wideColumns,
  rows: [{ kpi: "الإتقان", ...Object.fromEntries(wideColumns.slice(1).map((c) => [c.key, "قيمة"])) }],
  total: 1,
  truncated: false,
  filterLines: [],
  empty: false,
};

function makeDoc(over: Partial<SnapshotDoc> = {}): SnapshotDoc {
  return {
    version: 1,
    typeKey: "single",
    typeLabel: "تقرير النوع المفرد",
    title: "تقرير اختبار التصميم الرسمي",
    periodFrom: null,
    periodTo: null,
    periodText: null,
    generatedAtIso: "2026-08-10T09:30:00.000Z",
    generatedAtText: "2026/08/10م (1448/2/27هـ)",
    sections: [portraitSection, landscapeSection],
    identity: {
      orgLines: ["المملكة العربية السعودية — وزارة التعليم", "إدارة التعليم في محافظة صبيا", "مجمع الخشعة التعليمي للبنين"],
      schoolName: "مجمع الخشعة التعليمي للبنين",
      principalName: "مدير تجريبي",
      principalTitle: "مدير المجمع",
      academicYear: "1448-1449هـ",
      headerNote: "",
      footerNote: "منصة الإدارة المدرسية المتكاملة",
      ministryLogoFileId: null,
      schoolLogoFileId: null,
    },
    style: { ...officialConfig },
    templateKey: "official",
    showEmpty: false,
    // Small totals: no auto cover/TOC, so the title exists nowhere but the header.
    stats: { sectionCount: 2, totalRows: 2 },
    attachments: [],
    ...over,
  };
}

const bothLogos = { ministryLogo: pngAsset(), schoolLogo: jpgAsset() };
const noLogos = { ministryLogo: null, schoolLogo: null };

function zipText(buf: Buffer, pattern: RegExp): string {
  return new AdmZip(buf)
    .getEntries()
    .filter((e) => pattern.test(e.entryName))
    .map((e) => e.getData().toString("utf8"))
    .join("\n");
}

function entryNames(buf: Buffer): string[] {
  return new AdmZip(buf).getEntries().map((e) => e.entryName);
}

const headerXml = (buf: Buffer) => zipText(buf, /^word\/header\d+\.xml$/);
const footerXml = (buf: Buffer) => zipText(buf, /^word\/footer\d+\.xml$/);
const documentXml = (buf: Buffer) => zipText(buf, /^word\/document\.xml$/);
const allRels = (buf: Buffer) => zipText(buf, /\.rels$/);

/* ─────────────────── image assets ─────────────────── */

describe("Word image assets", () => {
  it("parses PNG and JPEG with intrinsic dimensions", () => {
    const png = toWordImageAsset(PNG_1PX, "image/png");
    expect(png).toMatchObject({ type: "png", width: 1, height: 1 });
    const jpg = toWordImageAsset(JPG_1PX, "image/jpeg");
    expect(jpg).toMatchObject({ type: "jpg", width: 1, height: 1 });
  });

  it("rejects garbage, mismatched mime, and non-embeddable types", () => {
    expect(toWordImageAsset(Buffer.from("not an image at all"), "image/png")).toBeNull();
    expect(toWordImageAsset(PNG_1PX, "image/jpeg")).toBeNull();
    expect(toWordImageAsset(JPG_1PX, "image/png")).toBeNull();
    expect(toWordImageAsset(PNG_1PX, "image/webp")).toBeNull();
    expect(toWordImageAsset(Buffer.alloc(0), "image/png")).toBeNull();
  });

  it("fitImage preserves aspect ratio and never scales up", () => {
    const wide = { data: PNG_1PX, type: "png" as const, width: 900, height: 300 };
    expect(fitImage(wide, 90, 58)).toEqual({ width: 90, height: 30 });
    const tall = { data: PNG_1PX, type: "png" as const, width: 100, height: 580 };
    expect(fitImage(tall, 90, 58)).toEqual({ width: 10, height: 58 });
    const small = { data: PNG_1PX, type: "png" as const, width: 30, height: 20 };
    expect(fitImage(small, 90, 58)).toEqual({ width: 30, height: 20 });
  });
});

/* ─────────────────── the official three-zone header ─────────────────── */

describe("official three-zone Word header (instance path)", () => {
  it("is a real header with the zone table: identity right, title central, meta left, both logos embedded", async () => {
    const buf = await buildInstanceDocx(makeDoc(), { reportNumber: "42/1448" }, bothLogos);
    const header = headerXml(buf);
    // Zone structure is a table inside the running header
    expect(header).toContain("<w:tbl>");
    expect(header).toContain("<w:bidiVisual");
    // Right zone: organization lines
    expect(header).toContain("مجمع الخشعة التعليمي للبنين");
    // Central zone: title + year
    expect(header).toContain("تقرير اختبار التصميم الرسمي");
    expect(header).toContain("العام الدراسي: 1448-1449هـ");
    // Left zone: report number + issue date
    expect(header).toContain("رقم التقرير: 42/1448");
    expect(header).toContain("تاريخ الإصدار:");
    // Both logos are native embedded images
    expect((header.match(/<w:drawing>/g) ?? []).length).toBe(2);
    expect(entryNames(buf).filter((n) => n.startsWith("word/media/")).length).toBeGreaterThanOrEqual(2);
    // Primary-color separator below the header
    expect(header).toContain('w:color="1f5244"');
  });

  it("never references external resources — all relationships are internal", async () => {
    const buf = await buildInstanceDocx(makeDoc(), { reportNumber: "42/1448" }, bothLogos);
    expect(allRels(buf)).not.toContain('TargetMode="External"');
  });

  it("missing or invalid logos degrade safely to the text identity", async () => {
    const buf = await buildInstanceDocx(makeDoc(), { reportNumber: null }, noLogos);
    const header = headerXml(buf);
    expect(header).not.toContain("<w:drawing>");
    expect(header).toContain("مجمع الخشعة التعليمي للبنين");
  });

  it("showLogos=false keeps the identity but drops the logos even when assets exist", async () => {
    const doc = makeDoc({ style: { ...officialConfig, showLogos: false } });
    const buf = await buildInstanceDocx(doc, { reportNumber: "1/1448" }, bothLogos);
    const header = headerXml(buf);
    expect(header).not.toContain("<w:drawing>");
    expect(header).toContain("مجمع الخشعة التعليمي للبنين");
  });

  it("the «بلا هوية» template produces the clean plain header: no identity block, no logos", async () => {
    const plain = baseTemplateByKey("plain")!.config;
    const doc = makeDoc({ style: { ...plain }, templateKey: "plain" });
    const buf = await buildInstanceDocx(doc, { reportNumber: null }, bothLogos);
    const header = headerXml(buf);
    expect(header).not.toContain("<w:tbl>");
    expect(header).not.toContain("<w:drawing>");
    expect(header).not.toContain("مجمع الخشعة التعليمي للبنين");
    expect(header).toContain("تقرير اختبار التصميم الرسمي");
  });

  it("the header is defined once and inherited across the portrait and landscape sections — no body duplication", async () => {
    const buf = await buildInstanceDocx(makeDoc(), { reportNumber: "42/1448" }, bothLogos);
    const body = documentXml(buf);
    expect(body).toContain('w:orient="landscape"');
    expect(body).toContain('w:orient="portrait"');
    // One headerReference on the first section; later sections inherit by OOXML semantics.
    expect((body.match(/<w:headerReference/g) ?? []).length).toBe(1);
    // The title lives in the running header only — never duplicated in the body.
    expect(body).not.toContain("تقرير اختبار التصميم الرسمي");
  });

  it("primary and accent identity colors drive the design elements", async () => {
    const custom = { ...officialConfig, primaryColor: "#123456", accentColor: "#abcdef" };
    const buf = await buildInstanceDocx(makeDoc({ style: custom }), { reportNumber: "9/1448" }, noLogos);
    // Header: title + separator carry the primary color
    expect(headerXml(buf)).toContain('w:color="123456"');
    const body = documentXml(buf);
    // Section headings: primary text + accent side rule
    expect(body).toContain('w:val="123456"');
    expect(body).toContain('w:color="abcdef"');
  });
});

/* ─────────────────── official tables ─────────────────── */

describe("official table design", () => {
  it("grid #cfcabc, header fill #f2f0eb, native cell margins, repeated header row, rows never split", async () => {
    const buf = await buildInstanceDocx(makeDoc(), { reportNumber: "42/1448" }, noLogos);
    const body = documentXml(buf);
    expect(body).toContain('w:color="CFCABC"');
    expect(body).toContain('w:fill="F2F0EB"');
    expect(body).toContain("<w:tblCellMar>");
    expect(body).toContain('w:w="105"');
    expect(body).toContain("<w:tblHeader");
    expect(body).toContain("<w:cantSplit");
    expect(body).toContain("<w:bidiVisual");
  });

  it("compact density tightens the native cell margins", async () => {
    const compact = { ...baseTemplateByKey("analytical")!.config };
    const buf = await buildInstanceDocx(makeDoc({ style: compact, templateKey: "analytical" }), { reportNumber: null }, noLogos);
    const body = documentXml(buf);
    expect(body).toContain('w:w="45"');
    expect(body).not.toContain('w:w="105"');
  });
});

/* ─────────────────── footer ─────────────────── */

describe("official footer", () => {
  it("real footer: separator rule, configured text, live PAGE/NUMPAGES fields", async () => {
    const buf = await buildInstanceDocx(makeDoc(), { reportNumber: "42/1448" }, noLogos);
    const footer = footerXml(buf);
    expect(footer).toContain("منصة الإدارة المدرسية المتكاملة");
    expect(footer).toContain("PAGE");
    expect(footer).toContain("NUMPAGES");
    expect(footer).toContain('w:color="DDDDDD"');
  });
});

/* ─────────────────── approval area ─────────────────── */

describe("principal approval area", () => {
  it("instance path: stable two-block layout with title, name, date line, signature line and stamp area", async () => {
    const buf = await buildInstanceDocx(makeDoc(), { reportNumber: "42/1448" }, noLogos);
    const body = documentXml(buf);
    expect(body).toContain("مدير المجمع");
    expect(body).toContain("مدير تجريبي");
    expect(body).toContain("التاريخ:");
    expect(body).toContain("الختم");
    expect(body).toContain('w:color="999999"');
  });

  it("legacy path embeds the stored signature and stamp assets when the identity settings include them", async () => {
    const buf = await buildWordReport({
      title: "تقرير برنامج تجريبي",
      meta: [["تاريخ الإصدار", "1448/02/27هـ"]],
      sections: [{ heading: "قسم", paragraphs: ["فقرة"] }],
      header: {
        orgLines: ["وزارة التعليم", "مجمع الخشعة التعليمي للبنين"],
        principalTitle: "مدير المجمع",
        principalName: "مدير تجريبي",
        signature: pngAsset(),
        stamp: jpgAsset(),
      },
    });
    const body = documentXml(buf);
    expect((body.match(/<w:drawing>/g) ?? []).length).toBe(2);
    expect(body).toContain("مدير المجمع");
    expect(body).toContain("التاريخ:");
    expect(body).toContain("الختم");
    expect(allRels(buf)).not.toContain('TargetMode="External"');
  });
});

/* ─────────────────── all five base templates ─────────────────── */

describe("all five base templates produce the official design", () => {
  for (const template of BASE_TEMPLATES) {
    it(`قالب «${template.labelAr}»`, async () => {
      const doc = makeDoc({ style: { ...template.config }, templateKey: template.key });
      const buf = await buildInstanceDocx(doc, { reportNumber: "7/1448" }, bothLogos);
      expect(buf.subarray(0, 2).toString()).toBe("PK");
      const header = headerXml(buf);
      expect(header).toContain("تقرير اختبار التصميم الرسمي");
      if (template.config.showIdentity) {
        expect(header).toContain("مجمع الخشعة التعليمي للبنين");
      } else {
        expect(header).not.toContain("مجمع الخشعة التعليمي للبنين");
      }
      const logosExpected = template.config.showIdentity && template.config.showLogos ? 2 : 0;
      expect((header.match(/<w:drawing>/g) ?? []).length).toBe(logosExpected);
      expect(allRels(buf)).not.toContain('TargetMode="External"');
    });
  }
});

/* ─────────────────── legacy registry export ─────────────────── */

describe("legacy registry Word export shares the same visual system", () => {
  it("three-zone header with logos, footer with live fields, official table grid", async () => {
    const buf = await buildWordReport({
      title: "تقرير سجل البرامج",
      meta: [
        ["عدد الصفوف", "2"],
        ["تاريخ التوليد", "2026/08/10م"],
      ],
      sections: [
        {
          heading: "سجل البرامج",
          table: { headers: ["البرنامج", "الحالة"], rows: [["برنامج القراءة", "معتمد"], ["برنامج الحاسب", "قيد التنفيذ"]] },
        },
      ],
      header: {
        orgLines: ["المملكة العربية السعودية — وزارة التعليم", "مجمع الخشعة التعليمي للبنين"],
        academicYear: "1448-1449هـ",
        footerNote: "منصة الإدارة المدرسية المتكاملة",
        primaryColor: "#1f5244",
        accentColor: "#348066",
        ministryLogo: pngAsset(),
        schoolLogo: jpgAsset(),
      },
      issuedAtText: "2026/08/10م (1448/2/27هـ)",
    });
    const header = headerXml(buf);
    expect(header).toContain("<w:tbl>");
    expect(header).toContain("تقرير سجل البرامج");
    expect(header).toContain("تاريخ الإصدار: 2026/08/10م (1448/2/27هـ)");
    expect((header.match(/<w:drawing>/g) ?? []).length).toBe(2);
    const footer = footerXml(buf);
    expect(footer).toContain("PAGE");
    expect(footer).toContain("منصة الإدارة المدرسية المتكاملة");
    const body = documentXml(buf);
    expect(body).toContain('w:color="CFCABC"');
    expect(body).toContain('w:fill="F2F0EB"');
    expect(body).toContain("<w:tblHeader");
    expect(body).toContain('w:color="348066"');
    expect(allRels(buf)).not.toContain('TargetMode="External"');
  });

  it("headerless fallback keeps the neutral org line and the official green defaults", async () => {
    const buf = await buildWordReport({
      title: "معاينة قالب",
      meta: [["نوع الوثيقة", "خطاب"]],
      sections: [{ heading: "المحتوى", paragraphs: ["نص"] }],
    });
    const header = headerXml(buf);
    expect(header).toContain("مجمع الخشعة التعليمي للبنين — منصة الإدارة المدرسية المتكاملة");
    expect(header).toContain('w:color="1f5244"');
  });
});

/* ─────────────────── the reserved header band (fade36f gate defect) ─────────────────── */

function pageMargins(buf: Buffer): { top: number; header: number; bottom: number }[] {
  const doc = documentXml(buf);
  return [...doc.matchAll(/<w:pgMar[^/]*\/>/g)].map(([m]) => ({
    top: Number(/w:top="(\d+)"/.exec(m)![1]),
    header: Number(/w:header="(\d+)"/.exec(m)![1]),
    bottom: Number(/w:bottom="(\d+)"/.exec(m)![1]),
  }));
}

describe("header band reservation — continuation pages must never enter the header", () => {
  // A single portrait table long enough to paginate across ≥3 A4 pages in any
  // renderer (150 rows ≈ 6+ portrait pages at ~25 rows/page), with BOTH logos —
  // the exact shape of the rejected «تقرير رسمي» sample.
  const longSection: SnapshotSection = {
    key: "long",
    reportKey: "programs-active",
    label: "سجل البرامج الطويل",
    columns: [
      { key: "name", label: "البرنامج" },
      { key: "owner", label: "المسؤول" },
      { key: "status", label: "الحالة" },
    ],
    rows: Array.from({ length: 150 }, (_, i) => ({
      name: `برنامج اصطناعي طويل الاسم لاختبار الالتفاف رقم ${i + 1}`,
      owner: `منسّق تجريبي ${(i % 3) + 1}`,
      status: "قيد التنفيذ",
    })),
    total: 150,
    truncated: false,
    filterLines: [],
    empty: false,
  };
  const longDoc = (over: Partial<SnapshotDoc> = {}) =>
    makeDoc({ sections: [longSection], stats: { sectionCount: 1, totalRows: 150 }, ...over });

  it("branded long table: every section reserves header distance + estimated header height", async () => {
    const buf = await buildInstanceDocx(longDoc(), { reportNumber: "42/1448" }, bothLogos);
    const margins = pageMargins(buf);
    expect(margins.length).toBeGreaterThan(0);
    for (const m of margins) {
      // The header starts 8 mm from the edge…
      expect(m.header).toBe(HEADER_DISTANCE_TWIPS);
      // …and the body must start below the full estimated header, never at the
      // old fixed 15 mm (850 twips) that let continuations paint over the header.
      expect(m.top).toBeGreaterThanOrEqual(convertMillimetersToTwip(28));
      expect(m.top).toBeLessThanOrEqual(convertMillimetersToTwip(60));
      expect(m.top).toBeGreaterThan(850);
      // The footer band stays reserved too.
      expect(m.bottom).toBeGreaterThanOrEqual(convertMillimetersToTwip(15));
    }
    // The reserve covers the content-derived estimate with its cushion.
    const doc = longDoc();
    const estimate = officialHeaderHeightTwips({
      orgLines: doc.identity.orgLines,
      title: doc.title,
      subtitle: doc.typeLabel,
      academicYear: doc.identity.academicYear,
      metaLines: [{ text: "رقم التقرير: 42/1448", bold: true }, { text: `تاريخ الإصدار: ${doc.generatedAtText}` }],
      ministryLogo: bothLogos.ministryLogo,
      schoolLogo: bothLogos.schoolLogo,
      primaryColor: "#1f5244",
    });
    expect(margins[0].top).toBeGreaterThanOrEqual(HEADER_DISTANCE_TWIPS + estimate);
    // Repeating table header + non-splitting rows survive the geometry change.
    const xml = documentXml(buf);
    expect(xml).toContain("<w:tblHeader");
    expect(xml).toContain("<w:cantSplit");
    expect(footerXml(buf)).toContain("PAGE");
  });

  it("portrait and landscape sections share one identical band", async () => {
    const buf = await buildInstanceDocx(makeDoc(), { reportNumber: "42/1448" }, bothLogos);
    const tops = new Set(pageMargins(buf).map((m) => m.top));
    expect(pageMargins(buf).length).toBeGreaterThanOrEqual(2);
    expect(tops.size).toBe(1);
  });

  it("the reserve tracks the header's actual content: logos and long titles grow it, never shrink it", async () => {
    const short = pageMargins(await buildInstanceDocx(longDoc(), { reportNumber: null }, noLogos))[0].top;
    const withLogos = pageMargins(await buildInstanceDocx(longDoc(), { reportNumber: null }, bothLogos))[0].top;
    expect(withLogos).toBeGreaterThanOrEqual(short);
    const hugeTitle = "تقرير سنوي شامل مفصّل عن كامل أعمال الخطة التشغيلية ومؤشراتها ولجانها وبرامجها وشواهدها للعام الدراسي بطوله وامتداده";
    const withHugeTitle = pageMargins(
      await buildInstanceDocx(longDoc({ title: hugeTitle }), { reportNumber: null }, bothLogos),
    )[0].top;
    expect(withHugeTitle).toBeGreaterThan(withLogos);
  });

  it("identity-free documents keep a compact reserved band", async () => {
    const plain = baseTemplateByKey("plain")!.config;
    const buf = await buildInstanceDocx(longDoc({ style: { ...plain }, templateKey: "plain" }), { reportNumber: null }, noLogos);
    const m = pageMargins(buf)[0];
    expect(m.header).toBe(HEADER_DISTANCE_TWIPS);
    expect(m.top).toBeGreaterThanOrEqual(convertMillimetersToTwip(18));
    expect(m.top).toBeLessThanOrEqual(convertMillimetersToTwip(40));
    const branded = pageMargins(await buildInstanceDocx(longDoc(), { reportNumber: null }, bothLogos))[0];
    expect(m.top).toBeLessThan(branded.top);
  });

  it("the legacy registry path reserves the same band", async () => {
    const buf = await buildWordReport({
      title: "تقرير سجل البرامج الطويل جداً بعنوان يلتف على أكثر من سطر واحد",
      meta: [["عدد الصفوف", "150"]],
      sections: [
        {
          heading: "السجل",
          table: {
            headers: ["البرنامج", "الحالة"],
            rows: Array.from({ length: 150 }, (_, i) => [`برنامج اصطناعي طويل الاسم رقم ${i + 1}`, "قيد التنفيذ"]),
          },
        },
      ],
      header: {
        orgLines: ["المملكة العربية السعودية — وزارة التعليم", "إدارة التعليم في محافظة صبيا", "مجمع الخشعة التعليمي للبنين"],
        academicYear: "1448-1449هـ",
        footerNote: "منصة الإدارة المدرسية المتكاملة",
        ministryLogo: pngAsset(),
        schoolLogo: jpgAsset(),
      },
      issuedAtText: "2026/08/10م (1448/2/27هـ)",
    });
    const m = pageMargins(buf)[0];
    expect(m.header).toBe(HEADER_DISTANCE_TWIPS);
    expect(m.top).toBeGreaterThanOrEqual(convertMillimetersToTwip(28));
    expect(m.top).toBeGreaterThan(850);
  });
});

/* ─────────────────── the full instance entry point ─────────────────── */

describe("instanceDocx entry point", () => {
  it("null logo file IDs load as absent assets without touching storage", async () => {
    const buf = await instanceDocx(makeDoc(), { reportNumber: "42/1448" });
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    expect(headerXml(buf)).not.toContain("<w:drawing>");
  });
});

import { describe, it, expect } from "vitest";
import AdmZip from "adm-zip";
import ExcelJS from "exceljs";
import { instanceDocx } from "@/lib/reports/instances/export-docx";
import { instanceXlsx, safeSheetName } from "@/lib/reports/instances/export-xlsx";
import { assembleZip, verifyZip, zipEntryName, type ZipPart } from "@/lib/reports/instances/export-zip";
import { baseTemplateByKey } from "@/lib/reports/instances/base-templates";
import type { SnapshotDoc, SnapshotSection, SnapshotColumn } from "@/lib/reports/instances/options";

/**
 * v2.6 — مُصدِّرات التقرير المحفوظ: Word وExcel وحزمة ZIP (§F/§G).
 * اللقطة الواحدة تُبنى هنا مرة وتُفحص المخرجات بفتح الملفات فعلاً لا بالثقة بالمنشئ.
 */

/* ─────────────────── لقطة تمثيلية ─────────────────── */

const officialStyle = {
  ...baseTemplateByKey("official")!.config,
  showLogos: false,
  footerText: "منصة الإدارة المدرسية المتكاملة",
};

// قسم رأسي (5 أعمدة): نص عربي وخلية حقن صيغة وتاريخ ومال وعدد وخلية فارغة
const programsSection: SnapshotSection = {
  key: "programs",
  reportKey: "programs-active",
  label: "سجل البرامج",
  columns: [
    { key: "name", label: "البرنامج" },
    { key: "owner", label: "المسؤول" },
    { key: "startDate", label: "تاريخ البدء", type: "date" },
    { key: "cost", label: "التكلفة", type: "money" },
    { key: "sessions", label: "عدد الجلسات", type: "number" },
  ],
  rows: [
    { name: "برنامج القراءة", owner: "المعلم الأول", startDate: "2026-08-08", cost: 1234.5, sessions: 12 },
    { name: "=SUM(A1)", owner: null, startDate: "2026-09-01", cost: 500, sessions: 3 },
    { name: "برنامج الحاسب", owner: "المعلم الثاني", startDate: null, cost: 0, sessions: 7 },
  ],
  total: 3,
  truncated: false,
  filterLines: [],
  empty: false,
};

// قسم عريض (15 عموداً → أفقي) مقتطع وبمرشّحات معلنة
const wideColumns: SnapshotColumn[] = [
  { key: "kpi", label: "المؤشر" },
  ...Array.from({ length: 12 }, (_, i) => ({ key: `m${i}`, label: `قياس ${i + 1}` })),
  { key: "budget", label: "الميزانية", type: "money" },
  { key: "score", label: "الدرجة", type: "number" },
];
const wideRow = (kpi: string, budget: number, score: number): Record<string, string | number | null> => ({
  kpi,
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`m${i}`, `قيمة ${i + 1}`])),
  budget,
  score,
});
const wideSection: SnapshotSection = {
  key: "matrix",
  reportKey: "kpi-matrix",
  label: "مصفوفة المؤشرات التفصيلية",
  columns: wideColumns,
  rows: [wideRow("نسبة الإتقان", 1500, 88), wideRow("نسبة الحضور", 250.75, 93)],
  total: 120,
  truncated: true,
  filterLines: [
    ["الحالة", "نشط"],
    ["المجال", "التعليمي"],
  ],
  empty: false,
};

function makeDoc(over: Partial<SnapshotDoc> = {}): SnapshotDoc {
  return {
    version: 1,
    typeKey: "periodic",
    typeLabel: "تقرير دوري شامل",
    title: "التقرير الفصلي لأداء الخطة التشغيلية",
    periodFrom: "2026-01-01",
    periodTo: "2026-06-01",
    periodText: "2026/01/01م — 2026/06/01م",
    generatedAtIso: "2026-08-08T09:30:00.000Z",
    generatedAtText: "2026/08/08م (1448/2/25هـ)",
    sections: [programsSection, wideSection],
    identity: {
      orgLines: ["وزارة التعليم", "إدارة التعليم", "مجمع الخشعة التعليمي للبنين"],
      schoolName: "مجمع الخشعة التعليمي للبنين",
      principalName: "",
      principalTitle: "مدير المدرسة",
      academicYear: "1448هـ",
      headerNote: "",
      footerNote: "",
      ministryLogoFileId: null,
      schoolLogoFileId: null,
    },
    style: officialStyle,
    templateKey: "official",
    showEmpty: false,
    // مجموع كبير عمداً: يفعّل الغلاف والفهرس التلقائيين للتقرير الطويل (§F)
    stats: { sectionCount: 2, totalRows: 123 },
    attachments: [{ fileId: "att-1", name: "محضر اللجنة.pdf", source: "شاهد" }],
    ...over,
  };
}

/* ─────────────────── عوينات فحص DOCX ─────────────────── */

function docxEntry(buf: Buffer, name: string): string {
  const entry = new AdmZip(buf).getEntry(name);
  expect(entry, name).toBeTruthy();
  return entry!.getData().toString("utf8");
}

/** نص كل مداخل الأرشيف المطابقة للنمط مجموعاً — الترويسات والتذييلات مرقّمة */
function docxEntriesText(buf: Buffer, pattern: RegExp): string {
  return new AdmZip(buf)
    .getEntries()
    .filter((e) => pattern.test(e.entryName))
    .map((e) => e.getData().toString("utf8"))
    .join("\n");
}

describe("مُصدِّر Word (§F/§G)", () => {
  it("ملف صالح RTL كامل: bidi وعناوين مرقّمة واتجاها صفحة وترويسة جدول مكررة وصف لا ينقسم", async () => {
    const buf = await instanceDocx(makeDoc(), { reportNumber: null });
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    const xml = docxEntry(buf, "word/document.xml");
    expect(xml).toContain("<w:bidi");
    expect(xml).toContain("التقرير الفصلي لأداء الخطة التشغيلية");
    expect(xml).toContain("1. سجل البرامج");
    expect(xml).toContain("2. مصفوفة المؤشرات التفصيلية");
    expect(xml).toContain('w:orient="landscape"');
    expect(xml).toContain('w:orient="portrait"');
    expect(xml).toContain("<w:tblHeader");
    expect(xml).toContain("<w:cantSplit");
    // الخلية الفارغة شرطة، والمرشّحات وعدّاد الصفوف حاضرة كسطور وصفية
    expect(xml).toContain("—");
    expect(xml).toContain("الحالة: نشط");
    expect(xml).toContain("عدد الصفوف: 3");
  });

  it("الترويسة والتذييل ترويسة وتذييل Word حقيقيان: الهوية والعنوان فوق وترقيم الصفحات تحت", async () => {
    const buf = await instanceDocx(makeDoc(), { reportNumber: "42/1448" });
    const headers = docxEntriesText(buf, /^word\/header\d+\.xml$/);
    expect(headers).toContain("مجمع الخشعة التعليمي للبنين");
    expect(headers).toContain("التقرير الفصلي لأداء الخطة التشغيلية");
    expect(headers).toContain("رقم التقرير: 42/1448");
    const footers = docxEntriesText(buf, /^word\/footer\d+\.xml$/);
    expect(footers).toContain("PAGE");
    expect(footers).toContain("منصة الإدارة المدرسية المتكاملة");
  });

  it("المسودة تحمل ختم «مسودة — غير معتمدة» والمعتمد يحمل الرقم بلا ختم", async () => {
    const draft = await instanceDocx(makeDoc(), { reportNumber: null });
    expect(docxEntry(draft, "word/document.xml")).toContain("مسودة — غير معتمدة");
    const final = await instanceDocx(makeDoc(), { reportNumber: "42/1448" });
    expect(docxEntry(final, "word/document.xml")).not.toContain("مسودة — غير معتمدة");
    expect(docxEntriesText(final, /^word\/header\d+\.xml$/)).toContain("42/1448");
  });

  it("ملاحظة الاقتطاع وقسم المرفقات وخانة الاعتماد حاضرة في المتن", async () => {
    const xml = docxEntry(await instanceDocx(makeDoc(), { reportNumber: "42/1448" }), "word/document.xml");
    expect(xml).toContain("اقتُطع القسم عند حدّه الأقصى");
    expect(xml).toContain("3. الشواهد والمرفقات المستعملة");
    expect(xml).toContain("محضر اللجنة.pdf");
    expect(xml).toContain("مدير المدرسة");
    expect(xml).toContain("التوقيع:");
  });

  it("الغلاف والفهرس قائمة ثابتة لا حقل TOC، ويغيبان عن التقرير القصير", async () => {
    const long = docxEntry(await instanceDocx(makeDoc(), { reportNumber: null }), "word/document.xml");
    expect(long).toContain("المحتويات");
    expect(long).toContain("تاريخ الإصدار:");
    // لا حقل TableOfContents (يُغلَّف بـ<w:sdt>) — القائمة الثابتة لا تطالب بتحديث حقول
    expect(long).not.toContain("<w:sdt");

    const short = docxEntry(
      await instanceDocx(makeDoc({ stats: { sectionCount: 2, totalRows: 5 } }), { reportNumber: null }),
      "word/document.xml",
    );
    expect(short).not.toContain("المحتويات");
    expect(short).not.toContain("تاريخ الإصدار:");
  });

  it("فوق 18 عموداً: تقسيم بمجموعات مع تكرار العمود الأول وعبارة «جزء»", async () => {
    const hugeColumns: SnapshotColumn[] = [
      { key: "kpi", label: "المؤشر الأول" },
      ...Array.from({ length: 19 }, (_, i) => ({ key: `x${i}`, label: `عمود ${i + 1}` })),
    ];
    const hugeSection: SnapshotSection = {
      ...wideSection,
      key: "huge",
      label: "جدول ضخم",
      columns: hugeColumns,
      rows: [{ kpi: "مؤشر", ...Object.fromEntries(hugeColumns.slice(1).map((c) => [c.key, "قيمة"])) }],
      truncated: false,
      filterLines: [],
    };
    const xml = docxEntry(
      await instanceDocx(makeDoc({ sections: [hugeSection], stats: { sectionCount: 1, totalRows: 1 } }), {
        reportNumber: "1/1448",
      }),
      "word/document.xml",
    );
    expect(xml).toContain("جزء 1 من 2");
    expect(xml).toContain("جزء 2 من 2");
    expect((xml.match(/المؤشر الأول/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

/* ─────────────────── Excel ─────────────────── */

async function loadWorkbook(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

function sheetText(ws: ExcelJS.Worksheet): string {
  const out: string[] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => out.push(String(cell.value)));
  });
  return out.join(" | ");
}

describe("مُصدِّر Excel (§G)", () => {
  it("ورقة الملخص: RTL وهوية التقرير وقائمة الأقسام وكل المرشّحات", async () => {
    const wb = await loadWorkbook(await instanceXlsx(makeDoc(), { reportNumber: null }));
    const ws = wb.getWorksheet("الملخص");
    expect(ws).toBeTruthy();
    expect(ws!.views[0]?.rightToLeft).toBe(true);
    const text = sheetText(ws!);
    expect(text).toContain("التقرير الفصلي لأداء الخطة التشغيلية");
    expect(text).toContain("مسودة");
    expect(text).toContain("2026-08-08T09:30:00.000Z");
    expect(text).toContain("الحالة: نشط");
    expect(text).toContain("المجال: التعليمي");
    // عدد صفوف كل قسم رقم بجانب اسمه
    let programsTotal: unknown = null;
    ws!.eachRow((row) => {
      if (row.getCell(1).value === "سجل البرامج") programsTotal = row.getCell(2).value;
    });
    expect(programsTotal).toBe(3);
  });

  it("المعتمد يحمل رقم التقرير في الملخص بدل «مسودة»", async () => {
    const wb = await loadWorkbook(await instanceXlsx(makeDoc(), { reportNumber: "42/1448" }));
    const text = sheetText(wb.getWorksheet("الملخص")!);
    expect(text).toContain("42/1448");
    expect(text).not.toContain("مسودة");
  });

  it("أوراق الأقسام: الصيغة معطَّلة والرقم رقم والتاريخ مزدوج والمال بتنسيقه", async () => {
    const wb = await loadWorkbook(await instanceXlsx(makeDoc(), { reportNumber: null }));
    const ws = wb.getWorksheet("سجل البرامج");
    expect(ws).toBeTruthy();
    expect(ws!.views[0]?.rightToLeft).toBe(true);
    // ترويسة من تسميات الأعمدة
    expect(ws!.getCell("A1").value).toBe("البرنامج");
    // خلية حقن الصيغة معطَّلة بعلامة اقتباس — لا تبدأ بـ«=»
    const injected = String(ws!.getRow(3).getCell(1).value);
    expect(injected.startsWith("=")).toBe(false);
    expect(injected.startsWith("'")).toBe(true);
    expect(injected).toContain("=SUM(A1)");
    // الأرقام تبقى أرقاماً قابلة للحساب، والمال بتنسيق «#,##0.00»
    const cost = ws!.getRow(2).getCell(4);
    expect(typeof cost.value).toBe("number");
    expect(cost.value).toBe(1234.5);
    expect(cost.numFmt).toBe("#,##0.00");
    expect(typeof ws!.getRow(2).getCell(5).value).toBe("number");
    // التاريخ نص مزدوج التقويم (D-033)
    const date = String(ws!.getRow(2).getCell(3).value);
    expect(date).toContain("م (");
    expect(date).toContain("هـ");
  });

  it("القسم المقتطع يُختم بصف ملاحظة في ورقته", async () => {
    const wb = await loadWorkbook(await instanceXlsx(makeDoc(), { reportNumber: null }));
    const ws = wb.getWorksheet("مصفوفة المؤشرات التفصيلية");
    expect(ws).toBeTruthy();
    expect(sheetText(ws!)).toContain("اقتُطع القسم عند حده الأقصى");
  });

  it("safeSheetName: يحذف المحارف الممنوعة ويحدّ الطول بـ31 ويفرّد المكرر ولا يخرج فارغاً", () => {
    const cleaned = safeSheetName("تقرير[مالي]:*?خاص/سري\\جداً", new Set());
    expect(/[[\]:*?/\\]/.test(cleaned)).toBe(false);
    expect(cleaned.length).toBeGreaterThan(0);

    const long = safeSheetName("اسم قسم عربي طويل جداً يتجاوز حد إكسل الصارم للأسماء بلا شك", new Set());
    expect(long.length).toBeLessThanOrEqual(31);

    const taken = new Set<string>();
    expect(safeSheetName("البرامج", taken)).toBe("البرامج");
    expect(safeSheetName("البرامج", taken)).toBe("البرامج (2)");
    expect(safeSheetName("البرامج", taken)).toBe("البرامج (3)");

    expect(safeSheetName("///", new Set())).toBe("قسم");

    // المكرر الطويل يبقى تحت الحد بعد اللاحقة
    const base = "قسم طويل باسم ثابت تماماً هنا";
    const t2 = new Set<string>();
    safeSheetName(base, t2);
    const dup = safeSheetName(base, t2);
    expect(dup.length).toBeLessThanOrEqual(31);
    expect(dup.endsWith("(2)")).toBe(true);
  });
});

/* ─────────────────── حزمة ZIP ─────────────────── */

describe("حزمة ZIP (§G)", () => {
  const parts: ZipPart[] = [
    { name: "التقرير.docx", data: Buffer.from("محتوى وورد تجريبي") },
    { name: "الجداول.xlsx", data: Buffer.from("محتوى إكسل تجريبي") },
    { name: "مرفق.pdf", data: Buffer.from("محتوى PDF تجريبي") },
  ];
  const names = parts.map((p) => p.name);

  it("تجميع وتحقق ذهاباً وإياباً بأسماء عربية", () => {
    const data = assembleZip(parts);
    expect(verifyZip(data, names)).toBe(true);
    const zip = new AdmZip(data);
    for (const part of parts) {
      expect(zip.getEntry(part.name)!.getData().equals(part.data)).toBe(true);
    }
  });

  it("zipEntryName: يطهّر المسار والمحارف ويفرّد المكرر قبل الامتداد ولا يخرج فارغاً", () => {
    const evil = zipEntryName("../evil", new Set());
    expect(evil).not.toContain("..");
    expect(evil).not.toContain("/");
    expect(evil).toContain("evil");

    expect(zipEntryName("a/b\\c.pdf", new Set())).toBe("a-b-c.pdf");

    const withControl = zipEntryName(`تقرير${String.fromCharCode(7)}${String.fromCharCode(0)}.docx`, new Set());
    expect(withControl).toBe("تقرير.docx");

    const taken = new Set<string>();
    expect(zipEntryName("ملف.pdf", taken)).toBe("ملف.pdf");
    expect(zipEntryName("ملف.pdf", taken)).toBe("ملف (2).pdf");
    expect(zipEntryName("ملف.pdf", taken)).toBe("ملف (3).pdf");

    expect(zipEntryName("..", new Set()).length).toBeGreaterThan(0);
  });

  it("verifyZip يرفض المدخل الغائب والاسم المساري والأرشيف المعطوب", () => {
    const data = assembleZip(parts);
    expect(verifyZip(data, [...names, "غير-موجود.txt"])).toBe(false);

    // اسم بمسار داخلي — يُرفض حتى لو كان الأرشيف نفسه سليماً
    const traversal = new AdmZip();
    traversal.addFile("a/b.txt", Buffer.from("x"));
    expect(verifyZip(traversal.toBuffer(), ["a/b.txt"])).toBe(false);

    // عطب في وسط الأرشيف: قلب بايتات داخل بيانات المدخل يفشل الاستخراج أو يخالف الطول
    const big = assembleZip([{ name: "بيانات.txt", data: Buffer.from("سطر يتكرر كثيراً في الاختبار. ".repeat(60)) }]);
    const bad = Buffer.from(big);
    for (let i = 60; i < 90 && i < bad.length; i++) bad[i] ^= 0xff;
    expect(verifyZip(bad, ["بيانات.txt"])).toBe(false);
  });
});

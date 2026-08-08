import { describe, it, expect } from "vitest";
import { instanceHtml, styleOf, wantsCover, wantsToc } from "@/lib/reports/instances/render";
import { BASE_TEMPLATES } from "@/lib/reports/instances/base-templates";
import type { SnapshotDoc, SnapshotSection } from "@/lib/reports/instances/options";

/**
 * v2.6 §E/§F/§D — تصيير الوثيقة: القوالب الخمسة، الغلاف والفهرس، ومنع الحقن.
 *
 * `instanceHtml` هي مصدر PDF ومعاينة الطباعة معاً (D-060)، فما يثبت هنا يثبت في
 * الملف المطبوع حرفياً.
 */

const section = (over: Partial<SnapshotSection> = {}): SnapshotSection => ({
  key: "main",
  reportKey: "programs-active",
  label: "قسم تجريبي",
  columns: [
    { key: "name", label: "الاسم" },
    { key: "count", label: "العدد", type: "number" },
  ],
  rows: [{ name: "صف عربي", count: 3 }],
  total: 1,
  truncated: false,
  filterLines: [],
  empty: false,
  ...over,
});

const doc = (over: Partial<SnapshotDoc> = {}): SnapshotDoc => ({
  version: 1,
  typeKey: "single",
  typeLabel: "تقرير مجال واحد",
  title: "تقرير التصيير",
  periodFrom: "2026-01-01",
  periodTo: "2026-06-30",
  periodText: "من — إلى",
  generatedAtIso: "2026-08-08T09:00:00.000Z",
  generatedAtText: "2026/8/8م (1448/2/25هـ)",
  sections: [section()],
  identity: {
    orgLines: ["المملكة العربية السعودية — وزارة التعليم", "إدارة التعليم في محافظة صبيا", "مجمع الخشعة التعليمي للبنين"],
    schoolName: "مجمع الخشعة التعليمي للبنين",
    principalName: "مدير تجريبي",
    principalTitle: "مدير المجمع",
    academicYear: "1448-1449هـ",
    headerNote: "",
    footerNote: "منصة الإدارة المدرسية",
    ministryLogoFileId: null,
    schoolLogoFileId: null,
  },
  style: BASE_TEMPLATES[0].config as unknown as Record<string, unknown>,
  templateKey: "official",
  showEmpty: false,
  attachments: [],
  stats: { sectionCount: 1, totalRows: 1 },
  ...over,
});

describe("§E — القوالب الأساسية الخمسة تُصيَّر كلها", () => {
  for (const template of BASE_TEMPLATES) {
    it(`قالب «${template.labelAr}» يُصيَّر HTML صالحاً RTL`, async () => {
      const html = await instanceHtml(
        doc({ style: template.config as unknown as Record<string, unknown>, templateKey: template.key }),
        { reportNumber: "KHS-RPT-1448-0100" },
      );
      expect(html).toContain('dir="rtl"');
      expect(html).toContain("تقرير التصيير");
      if (template.config.showIdentity) {
        expect(html).toContain("إدارة التعليم في محافظة صبيا");
      } else {
        expect(html).not.toContain("إدارة التعليم في محافظة صبيا");
      }
      if (template.config.approvalBox) expect(html).toContain('class="signatures"');
      else expect(html).not.toContain('class="signatures"');
      expect(html).not.toContain("مكتب التعليم");
    });
  }
});

describe("§F — الغلاف والفهرس تلقائيان للتقرير الطويل", () => {
  it("التقرير القصير بلا غلاف ولا فهرس تلقائياً", () => {
    const d = doc();
    const style = styleOf(d);
    expect(wantsCover(d, style)).toBe(false);
    expect(wantsToc(d, style)).toBe(false);
  });

  it("التقرير الطويل (أقسام كثيرة أو صفوف كثيرة) يكسب الغلاف والفهرس تلقائياً", () => {
    const long = doc({
      sections: [section(), section({ key: "b" }), section({ key: "c" }), section({ key: "d" })],
      stats: { sectionCount: 4, totalRows: 400 },
    });
    const style = styleOf(long);
    expect(wantsCover(long, style)).toBe(true);
    expect(wantsToc(long, style)).toBe(true);
  });

  it("«نعم» و«لا» الصريحتان تغلبان التلقائي", () => {
    const d = doc({ style: { ...BASE_TEMPLATES[0].config, cover: "نعم", toc: "لا" } as unknown as Record<string, unknown> });
    const style = styleOf(d);
    expect(wantsCover(d, style)).toBe(true);
    expect(wantsToc(d, style)).toBe(false);
  });

  it("القسم العريض يحمل صنف الصفحة الأفقية والقسم الضيق لا", async () => {
    const wide = section({
      key: "wide",
      columns: Array.from({ length: 12 }, (_, i) => ({ key: `c${i}`, label: `عمود ${i}` })),
      rows: [Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`c${i}`, "قيمة"]))],
    });
    const html = await instanceHtml(doc({ sections: [section(), wide], stats: { sectionCount: 2, totalRows: 2 } }), {});
    expect(html).toContain('class="report-section landscape-section" id="section-wide"');
    expect(html).toContain('class="report-section " id="section-main"');
    expect(html).toContain("@page landscape");
  });
});

describe("§D/§H — لا حقن في الوثيقة المصيَّرة", () => {
  it("اسم خبيث في البيانات يُهرَّب ولا يصبح وسماً", async () => {
    const evil = section({ rows: [{ name: `<img src=x onerror="alert(1)">`, count: 1 }] });
    const html = await instanceHtml(doc({ sections: [evil] }), {});
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("عنوان خبيث وهوية خبيثة يُهرَّبان", async () => {
    const html = await instanceHtml(
      doc({
        title: `تقرير<script>alert(2)</script>`,
        identity: { ...doc().identity, principalName: `"><svg onload=x>` },
      }),
      {},
    );
    expect(html).not.toContain("<script>alert(2)");
    expect(html).not.toContain("<svg onload");
  });

  it("لون قالب ملفَّق لا يصل إلى CSS — يعود الأساس", async () => {
    const html = await instanceHtml(
      doc({ style: { ...BASE_TEMPLATES[0].config, primaryColor: "red;} body{display:none" } as unknown as Record<string, unknown> }),
      {},
    );
    expect(html).not.toContain("display:none");
    expect(html).toContain("#1f5244");
  });

  it("ختم «مسودة» على المسودة فقط", async () => {
    const draft = await instanceHtml(doc(), { draftBanner: true });
    const final = await instanceHtml(doc(), { reportNumber: "KHS-RPT-1448-0001" });
    expect(draft).toContain("مسودة — غير معتمدة");
    expect(final).not.toContain("مسودة — غير معتمدة");
    expect(final).toContain("KHS-RPT-1448-0001");
  });

  it("القسم الفارغ عند «إظهار الفارغ» يقول ذلك صراحةً", async () => {
    const html = await instanceHtml(
      doc({ showEmpty: true, sections: [section({ empty: true, rows: [], total: 0 })] }),
      {},
    );
    expect(html).toContain("لا بيانات مطابقة للمرشّحات في هذا القسم");
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import AdmZip from "adm-zip";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * v2.3 §7-8 — محرك التقارير والهوية الرسمية:
 *  - الترويسة من هوية الوثائق المركزية (اسم المدير ومسماه من الإعدادات لا من الشيفرة).
 *  - PDF بترويسة رسمية وترويسة جدول متكررة وأرقام صفحات.
 *  - Word بترويسة رسمية وخانة توقيع بالمسمى والاسم.
 */

let pool: Pool;

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
});

afterAll(async () => {
  await pool.end();
});

describe("هوية الوثائق المركزية", () => {
  it("اسم المدير ومسماه يُحفظان في الإعدادات ويظهران في الترويسة المحلولة", async () => {
    const { saveDocumentIdentity, getDocumentIdentity, resolveHeader } = await import("@/lib/document-identity");
    await saveDocumentIdentity({
      principalName: "مدير الاختبار بن فحص",
      principalTitle: "مدير مجمع الاختبار",
    });
    const identity = await getDocumentIdentity();
    expect(identity.principalName).toBe("مدير الاختبار بن فحص");
    expect(identity.principalTitle).toBe("مدير مجمع الاختبار");

    const header = resolveHeader(identity);
    expect(header.principalName).toBe("مدير الاختبار بن فحص");
    expect(header.principalTitle).toBe("مدير مجمع الاختبار");
    // إيقاف تضمين اسم المدير يوقف المسمى معه
    const without = resolveHeader(identity, { principalName: false });
    expect(without.principalName).toBe("");
    expect(without.principalTitle).toBe("");
  });

  it("getOfficialHeader يمرر الهوية للمولدات — والاسم غير موجود في الشيفرة", async () => {
    const { getOfficialHeader } = await import("@/lib/document-header");
    const header = await getOfficialHeader();
    expect(header.principalName).toBe("مدير الاختبار بن فحص");
    expect(header.signerTitle).toBe("مدير مجمع الاختبار");
    expect(header.orgLines.length).toBeGreaterThanOrEqual(3);
  });
});

describe("ترويسة PDF الرسمية", () => {
  it("officialPageHtml يعرض سطور الجهة واسم المدير ويهرّب القيم ويكرر ترويسة الجدول", async () => {
    const { officialPageHtml } = await import("@/lib/pdf");
    const html = officialPageHtml({
      title: "تقرير اختبار",
      bodyHtml: "<table><thead><tr><th>عمود</th></tr></thead><tbody><tr><td>قيمة</td></tr></tbody></table>",
      identity: {
        orgLines: ["المملكة العربية السعودية — وزارة التعليم", "إدارة تعليم صبيا", "مجمع الاختبار"],
        principalName: "مدير الاختبار <script>alert(1)</script>",
        signerTitle: "مدير مجمع الاختبار",
        academicYear: "1448-1449هـ",
        ministryLogoDataUri: "data:image/png;base64,iVBORw0KGgo=",
      },
    });
    expect(html).toContain("وزارة التعليم");
    expect(html).toContain("مدير مجمع الاختبار");
    expect(html).toContain("&lt;script&gt;"); // التهريب فعّال
    expect(html).not.toContain("<script>alert");
    expect(html).toContain('img class="logo"'); // الشعار المحلي
    expect(html).toContain("thead { display: table-header-group; }"); // ترويسة الجدول تتكرر
    expect(html).toContain("tr { page-break-inside: avoid; }"); // لا انقسام صف بين صفحتين
  });

  it("htmlToPdf يولّد PDF فعلياً مع أرقام الصفحات", async () => {
    const { officialPageHtml, htmlToPdf } = await import("@/lib/pdf");
    const html = officialPageHtml({
      title: "اختبار الأرقام",
      bodyHtml: "<p>محتوى</p>",
      identity: { orgLines: ["جهة"] },
    });
    const pdf = await htmlToPdf(html, { pageNumbers: true });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  }, 60_000);
});

describe("تصدير Word بالهوية الرسمية", () => {
  it("buildWordReport يضمّن سطور الجهة وخانة توقيع بالمسمى والاسم", async () => {
    const { buildWordReport } = await import("@/lib/reports/word-export");
    const buffer = await buildWordReport({
      title: "تقرير Word اختباري",
      meta: [["المرشّح", "الكل"]],
      sections: [{ heading: "القسم", table: { headers: ["أ"], rows: [["١"]] } }],
      header: {
        orgLines: ["المملكة العربية السعودية — وزارة التعليم", "مجمع الاختبار التعليمي"],
        principalName: "مدير الاختبار بن فحص",
        principalTitle: "مدير مجمع الاختبار",
        academicYear: "1448-1449هـ",
      },
    });
    // ملف docx = حاوية ZIP
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
    const zip = new AdmZip(buffer);
    const docXml = zip.readAsText("word/document.xml");
    expect(docXml).toContain("وزارة التعليم");
    expect(docXml).toContain("مدير الاختبار بن فحص");
    expect(docXml).toContain("مدير مجمع الاختبار");
    expect(docXml).toContain("تقرير Word اختباري");
  });

  it("بلا ترويسة: يسقط إلى السطر الافتراضي القديم (توافق رجعي)", async () => {
    const { buildWordReport } = await import("@/lib/reports/word-export");
    const buffer = await buildWordReport({
      title: "تقرير بلا هوية",
      meta: [],
      sections: [],
    });
    const zip = new AdmZip(buffer);
    const docXml = zip.readAsText("word/document.xml");
    expect(docXml).toContain("مجمع الخشعة التعليمي للبنين");
  });
});

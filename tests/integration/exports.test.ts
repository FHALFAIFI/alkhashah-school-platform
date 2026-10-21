import { describe, it, expect } from "vitest";
import AdmZip from "adm-zip";

describe("تصدير Word العربي (A17)", () => {
  it("يبني مستند Word صالحاً يحوي المحتوى العربي RTL", async () => {
    const { buildWordReport } = await import("@/lib/reports/word-export");
    const buf = await buildWordReport({
      title: "تقرير برنامج تجريبي",
      meta: [["تاريخ الإصدار", "1448/3/10هـ"]],
      sections: [
        { heading: "بطاقة البرنامج", table: { headers: ["البند", "القيمة"], rows: [["الهدف", "هدف تجريبي"]] } },
        { heading: "ملاحظات", paragraphs: ["فقرة عربية للاختبار"] },
      ],
    });
    // ملف docx = أرشيف zip يبدأ بـ PK — العنوان في ترويسة Word الحقيقية (تصميم v2.6)
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    const zip = new AdmZip(buf);
    const xml = zip.getEntry("word/document.xml")!.getData().toString("utf8");
    const headerXml = zip
      .getEntries()
      .filter((e) => /^word\/header\d+\.xml$/.test(e.entryName))
      .map((e) => e.getData().toString("utf8"))
      .join("\n");
    expect(headerXml).toContain("تقرير برنامج تجريبي");
    expect(xml).toContain("فقرة عربية للاختبار");
    expect(xml).toContain("bidi"); // اتجاه RTL مفعل
  });
});

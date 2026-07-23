import { describe, it, expect } from "vitest";
import { DEFAULT_IDENTITY, resolveHeader } from "@/lib/document-identity";

describe("هوية الوثائق المركزية (§6)", () => {
  it("القيم الافتراضية تنتج ترويسة المجمع الرسمية كاملة", () => {
    const h = resolveHeader(DEFAULT_IDENTITY);
    expect(h.orgLines).toContain("مجمع الخشعة التعليمي للبنين");
    expect(h.orgLines.length).toBe(4);
  });

  it("الاستبعاد يحذف العنصر من الترويسة", () => {
    const h = resolveHeader(DEFAULT_IDENTITY, { educationOffice: false, schoolName: false });
    expect(h.orgLines).not.toContain("مكتب تعليم العيدابي");
    expect(h.orgLines).not.toContain("مجمع الخشعة التعليمي للبنين");
    expect(h.orgLines.length).toBe(2);
  });

  it("التوقيع والختم مستبعدان افتراضياً ويُضمّنان عند التفعيل", () => {
    expect(resolveHeader(DEFAULT_IDENTITY).showSignature).toBe(false);
    expect(resolveHeader(DEFAULT_IDENTITY).showStamp).toBe(false);
    const on = resolveHeader({ ...DEFAULT_IDENTITY, signatureFileId: "f1", stampFileId: "f2" }, { signature: true, stamp: true });
    expect(on.showSignature).toBe(true);
    expect(on.signatureFileId).toBe("f1");
    expect(on.stampFileId).toBe("f2");
  });

  it("التجاوز لكل وثيقة يغلب القيمة العامة دون تغيير الإعداد المركزي", () => {
    const h = resolveHeader(DEFAULT_IDENTITY, {}, { schoolName: "مدرسة مؤقتة" });
    expect(h.orgLines).toContain("مدرسة مؤقتة");
    // المصدر لم يتغير
    expect(DEFAULT_IDENTITY.schoolName).toBe("مجمع الخشعة التعليمي للبنين");
  });

  it("اسم المدير والعام الدراسي يظهران عند التضمين ويُخفيان عند الاستبعاد", () => {
    const id = { ...DEFAULT_IDENTITY, principalName: "فلان الفلاني" };
    expect(resolveHeader(id).principalName).toBe("فلان الفلاني");
    expect(resolveHeader(id, { principalName: false }).principalName).toBe("");
    expect(resolveHeader(id).academicYear).toBe("1448-1449هـ");
    expect(resolveHeader(id, { academicYear: false }).academicYear).toBe("");
  });
});

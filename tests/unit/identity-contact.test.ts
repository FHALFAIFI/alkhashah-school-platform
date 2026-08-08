import { describe, it, expect } from "vitest";
import { resolveHeader, DEFAULT_IDENTITY } from "@/lib/document-identity";
import { instanceHtml } from "@/lib/reports/instances/render";
import { BASE_TEMPLATES } from "@/lib/reports/instances/base-templates";
import type { SnapshotDoc } from "@/lib/reports/instances/options";

/**
 * v2.6 §E — بيانات الاتصال المركزية وتجاوزها لكل تقرير.
 */

const doc = (contactInfo: string, templateKey = "official"): SnapshotDoc => ({
  version: 1,
  typeKey: "single",
  typeLabel: "تقرير",
  title: "تقرير الاتصال",
  periodFrom: null,
  periodTo: null,
  periodText: null,
  generatedAtIso: "2026-08-08T00:00:00.000Z",
  generatedAtText: "2026-08-08",
  sections: [
    {
      key: "main",
      reportKey: "programs-active",
      label: "قسم",
      columns: [{ key: "name", label: "الاسم" }],
      rows: [{ name: "صف" }],
      total: 1,
      truncated: false,
      filterLines: [],
      empty: false,
    },
  ],
  identity: {
    orgLines: ["وزارة التعليم", "إدارة التعليم في محافظة صبيا", "مجمع الخشعة التعليمي للبنين"],
    schoolName: "مجمع الخشعة التعليمي للبنين",
    principalName: "مدير",
    principalTitle: "مدير المجمع",
    academicYear: "",
    headerNote: "",
    footerNote: "",
    contactInfo,
    ministryLogoFileId: null,
    schoolLogoFileId: null,
  },
  style: (BASE_TEMPLATES.find((t) => t.key === templateKey) ?? BASE_TEMPLATES[0]).config as unknown as Record<string, unknown>,
  templateKey,
  showEmpty: false,
  attachments: [],
  stats: { sectionCount: 1, totalRows: 1 },
});

describe("بيانات الاتصال في الهوية المركزية", () => {
  it("الافتراضي فارغ ولا يُختلق", () => {
    expect(DEFAULT_IDENTITY.contactInfo).toBe("");
  });

  it("resolveHeader يمرّر القيمة المركزية", () => {
    const resolved = resolveHeader({ ...DEFAULT_IDENTITY, contactInfo: "هاتف: 0170000000" });
    expect(resolved.contactInfo).toBe("هاتف: 0170000000");
  });

  it("تجاوز الوثيقة يغلب المركزي ولا يغيّره", () => {
    const central = { ...DEFAULT_IDENTITY, contactInfo: "المركزي" };
    const resolved = resolveHeader(central, {}, { contactInfo: "تجاوز التقرير" });
    expect(resolved.contactInfo).toBe("تجاوز التقرير");
    expect(central.contactInfo).toBe("المركزي");
  });
});

describe("عرض بيانات الاتصال في التقرير", () => {
  it("تظهر في الترويسة حين تكون الهوية ظاهرة", async () => {
    const html = await instanceHtml(doc("هاتف: 0170000000 — بريد: school@example.invalid"), {});
    expect(html).toContain("0170000000");
    expect(html).toContain('class="contact"');
  });

  it("لا تظهر في قالب «بلا هوية»", async () => {
    const html = await instanceHtml(doc("هاتف: 0170000000", "plain"), {});
    expect(html).not.toContain("0170000000");
  });

  it("الفراغ لا يترك سطراً فارغاً", async () => {
    const html = await instanceHtml(doc(""), {});
    expect(html).not.toContain('class="contact"');
  });

  it("قيمة خبيثة تُهرَّب ولا تصبح وسماً", async () => {
    const html = await instanceHtml(doc(`<img src=x onerror="alert(1)">`), {});
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });
});

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { templateDefinitions, templateVersions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { htmlToPdf } from "@/lib/pdf";
import { buildWordReport } from "@/lib/reports/word-export";
import { configOf } from "@/lib/templates/service";
import { renderTemplate, sampleValues, sampleTable } from "@/lib/templates/render";
import { DOC_TYPE_LABELS, mergeWithDefaults, type TemplateDocType } from "@/lib/templates/schema";
import { columnsFor, resolveColumns, resolveSections } from "@/lib/templates/structure";
import { recordSourceFor } from "@/lib/templates/records";
import { renderPlaceholders } from "@/lib/templates/placeholders";

/**
 * مخرجات معاينة القالب: PDF وWord (v2.2 §E2/§E4).
 *
 * الغرض إثبات أن ترتيب الأقسام والأعمدة وإخفاءها وتسميتها يظهر في **مخرجات الطباعة
 * الفعلية** لا في المتصفح وحده.
 *
 * **معاينة لا إصدار**: لا تُنشأ وثيقة ولا رقم وثيقة ولا لقطة مجمّدة، ولا يُعدَّل أي سجل.
 * **التفويض**: تسجيل الدخول + `admin.settings` (إدارة القوالب)، وعند طلب سجل حقيقي تُضاف
 * صلاحية قراءة نوع السجل، ويُعاد اشتقاق السجل من مصدره المحدود (حارس IDOR).
 */

const querySchema = z.object({
  template: z.string().uuid("معرّف القالب غير صالح"),
  version: z.string().uuid("معرّف النسخة غير صالح").optional(),
  record: z.string().uuid("معرّف السجل غير صالح").optional(),
  format: z.enum(["pdf", "docx"]).default("pdf"),
});

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
  if (!user.permissions.has("admin.settings")) {
    return NextResponse.json({ error: "لا تملك الصلاحية" }, { status: 403 });
  }

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const q = parsed.data;

  const [template] = await db.select().from(templateDefinitions).where(eq(templateDefinitions.id, q.template));
  if (!template) return NextResponse.json({ error: "القالب غير موجود" }, { status: 404 });
  const docType = template.docType as TemplateDocType;

  // النسخة المطلوبة يجب أن تنتمي لهذا القالب — لا تُقرأ نسخة قالب آخر بمعرّفها
  let version: typeof templateVersions.$inferSelect | null = null;
  if (q.version) {
    const [v] = await db.select().from(templateVersions).where(eq(templateVersions.id, q.version));
    if (!v || v.templateId !== template.id) return NextResponse.json({ error: "النسخة غير موجودة" }, { status: 404 });
    version = v;
  } else if (template.currentVersionId) {
    const [v] = await db.select().from(templateVersions).where(eq(templateVersions.id, template.currentVersionId));
    version = v ?? null;
  }
  const config = configOf(version);

  let values: Record<string, string | number | null | undefined> = sampleValues();
  let table = sampleTable(docType);
  let recordLabel = "بيانات نموذجية";

  if (q.record) {
    const source = recordSourceFor(docType);
    if (!source) return NextResponse.json({ error: "لا سجلات لهذا النوع" }, { status: 400 });
    if (!user.permissions.has(source.permission)) {
      return NextResponse.json({ error: "لا تملك صلاحية قراءة هذا النوع من السجلات" }, { status: 403 });
    }
    const record = await source.load(q.record);
    if (!record) return NextResponse.json({ error: "السجل غير متاح" }, { status: 404 });
    values = { ...values, ...record.values };
    table = record.table;
    recordLabel = record.recordLabel;
  }

  await audit({
    actorId: user.id,
    action: "template.preview_export",
    entityType: "template",
    entityId: template.id,
    summary: `تصدير معاينة قالب ${DOC_TYPE_LABELS[docType]} بصيغة ${q.format} — لم تصدر وثيقة`,
    detail: { format: q.format, withRecord: Boolean(q.record) },
  });

  const fileBase = `معاينة_${DOC_TYPE_LABELS[docType]}`;

  if (q.format === "docx") {
    const buf = await buildWordReport(wordModel(config, docType, values, table, recordLabel));
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${fileBase}.docx`)}`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const html = renderTemplate(config, { values, docType, table });
  const pdf = await htmlToPdf(html);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(`${fileBase}.pdf`)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * نموذج Word مبني من **الإعداد نفسه**: الأقسام المخفية تُحذف، والترتيب يُحترم،
 * والأعمدة تُصفّى وتُرتَّب وتُسمّى كما في HTML وPDF — فلا تختلف صيغة عن أخرى.
 *
 * `renderPlaceholders` يعيد HTML مهرَّباً؛ Word يحتاج نصاً عادياً فتُفكّ الكيانات الخمسة
 * التي يولّدها المهرِّب وحدها — لا تفسير HTML عام.
 */
function wordModel(
  config: ReturnType<typeof configOf>,
  docType: TemplateDocType,
  values: Record<string, string | number | null | undefined>,
  table: Record<string, string | number | null | undefined>[],
  recordLabel: string,
) {
  const merged = mergeWithDefaults(config);
  const t = merged.text ?? {};
  const sig = merged.signature ?? {};
  const identity = merged.identity ?? {};
  const plain = (text: string | undefined) => (text ? unescapeEntities(renderPlaceholders(text, values)) : "");

  const sections = resolveSections(merged.sections).filter((s) => s.visible);
  const visibleKeys = new Set(sections.map((s) => s.key));
  const headingFor = (key: string, fallback: string) => {
    const s = sections.find((x) => x.key === key);
    return s?.label ? plain(s.label) : fallback;
  };

  const out: { heading: string; paragraphs?: string[]; table?: { headers: string[]; rows: string[][] } }[] = [];

  if (visibleKeys.has("intro") && t.introText) out.push({ heading: headingFor("intro", "المقدمة"), paragraphs: [plain(t.introText)] });
  if (visibleKeys.has("fixed") && t.fixedText) out.push({ heading: headingFor("fixed", "نص ثابت"), paragraphs: [plain(t.fixedText)] });

  if (visibleKeys.has("body") && columnsFor(docType).length > 0) {
    const columns = resolveColumns(docType, merged.columns).filter((c) => c.visible);
    if (columns.length > 0) {
      out.push({
        heading: headingFor("body", "المحتوى"),
        table: {
          headers: columns.map((c) => plain(c.label)),
          rows: table.map((row) =>
            columns.map((c) => {
              const v = row[c.key];
              return v === null || v === undefined || String(v).trim() === "" ? "—" : String(v);
            }),
          ),
        },
      });
    }
  }

  if (visibleKeys.has("closing") && t.closingText) out.push({ heading: headingFor("closing", "الخاتمة"), paragraphs: [plain(t.closingText)] });
  if (visibleKeys.has("notes") && t.notes) out.push({ heading: headingFor("notes", "ملاحظات"), paragraphs: [plain(t.notes)] });
  if (visibleKeys.has("signature") && (sig.showSignature || sig.showStamp)) {
    out.push({
      heading: headingFor("signature", "التوقيع والاعتماد"),
      paragraphs: [sig.showSignature ? plain(sig.signatureLabel) : "", sig.showStamp ? plain(sig.approvalLabel) : ""].filter(Boolean),
    });
  }

  return {
    title: plain(t.titleAr) || DOC_TYPE_LABELS[docType],
    meta: [
      ["نوع الوثيقة", DOC_TYPE_LABELS[docType]] as [string, string],
      ["المصدر", recordLabel] as [string, string],
      ["الجهة", plain(identity.schoolName)] as [string, string],
      ["ملاحظة", "معاينة قالب — لم تصدر وثيقة ولم يتغيّر أي سجل"] as [string, string],
    ],
    sections: out,
  };
}

/** فكّ الكيانات الخمسة التي يولّدها `escapeHtml` — لا تفسير HTML عام */
function unescapeEntities(html: string): string {
  return html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

import "server-only";
import {
  AlignmentType,
  Document,
  Footer,
  Header,
  ImageRun,
  Packer,
  PageBreak,
  PageOrientation,
  Paragraph,
  Table,
  TextRun,
} from "docx";
import type { SnapshotDoc, SnapshotSection } from "./options";
import type { StyleConfig } from "./base-templates";
import { cellText, splitColumns, styleOf, tableLayoutFor, wantsCover, wantsToc } from "./render";
import {
  approvalArea,
  approvalSpacer,
  centeredPara,
  docxColor,
  fitImage,
  loadWordImageAsset,
  metaPara,
  officialDocStyles,
  officialHeaderHeightTwips,
  officialPageMargins,
  officialWordFooter,
  officialWordHeader,
  officialWordTable,
  plainHeaderHeightTwips,
  plainWordHeader,
  rtlPara,
  sectionHeading,
  META_SIZE,
  type WordImageAsset,
} from "../word-design";

/**
 * تصدير التقرير المحفوظ إلى Word قابل للتحرير (v2.6 §F/§G).
 *
 * المصدر هو `SnapshotDoc` المجمّد نفسه الذي يغذّي HTML/PDF — تطابق مصدرٍ لا تطابق
 * اجتهاد. والتصميم هو تصميم الوثيقة الرسمية المعتمد نفسه (`officialPageHtml` ومصيّر
 * v2.6) مبنياً بلبنات Word أصلية مشتركة من `word-design.ts`:
 *  - ترويسة Word حقيقية ثلاثية المناطق RTL: الشعار والهوية يميناً، العنوان والسنة
 *    وسطاً، رقم التقرير وتاريخ الإصدار وشعار المدرسة يساراً، وتحتها فاصل بلون الهوية.
 *  - الشعارات تُقرأ من التخزين المحلي الآمن فقط وتُضمَّن `ImageRun` أصلياً بنسبة
 *    أبعاد محفوظة — الشعار الغائب أو المتعذر يسقط بصمت وتبقى الهوية النصية.
 *  - قالب «بلا هوية» يُخرج ترويسة نظيفة بلا هوية ولا شعارات (`showIdentity`)،
 *    و`showLogos` يتحكم في الشعارات وحدها.
 *  - الجداول بتصميم الجدول الرسمي: حدود `#cfcabc`، ترويسة `#f2f0eb` عريضة تتكرر مع
 *    كل صفحة، هوامش خلايا أصلية بكثافة القالب، صف لا ينقسم.
 *  - الجدول العريض يُدار بقرار `tableLayoutFor` ذاته: القسم الأفقي مقطع Word مستقل
 *    بصفحة A4 أفقية، وفوق 18 عموداً تقسيم بمجموعات مع تكرار العمود الأول.
 *  - التذييل تذييل Word حقيقي بنص التذييل وحقلي PAGE/NUMPAGES الحيّين.
 */

/* ─────────────────── الترويسة والتذييل ─────────────────── */

export type InstanceDocxAssets = {
  ministryLogo: WordImageAsset | null;
  schoolLogo: WordImageAsset | null;
};

/**
 * نموذج الترويسة يُبنى مرة واحدة: منه ترويسة Word نفسها، ومنه تقدير ارتفاعها الذي
 * يحجز حزام الترويسة في هامش الصفحة العلوي — فجدول يتواصل عبر الصفحات لا يدخل
 * الترويسة أبداً (عيب بوابة fade36f: صفحات المتابعة كانت تبدأ داخل الترويسة).
 */
type HeaderModel =
  | { kind: "official"; opts: Parameters<typeof officialWordHeader>[0] }
  | { kind: "plain"; opts: Parameters<typeof plainWordHeader>[0] };

function headerModel(
  doc: SnapshotDoc,
  style: StyleConfig,
  reportNumber: string | null,
  assets: InstanceDocxAssets,
): HeaderModel {
  const issuedLine = `تاريخ الإصدار: ${doc.generatedAtText}`;
  if (!style.showIdentity) {
    return {
      kind: "plain",
      opts: {
        title: doc.title,
        metaLines: [reportNumber ? `رقم التقرير: ${reportNumber} — ${doc.generatedAtText}` : doc.generatedAtText],
        primaryColor: style.primaryColor,
      },
    };
  }
  return {
    kind: "official",
    opts: {
      orgLines: doc.identity.orgLines,
      headerNote: style.headerText || doc.identity.headerNote || undefined,
      contactInfo: doc.identity.contactInfo || undefined,
      title: doc.title,
      subtitle: `${doc.typeLabel}${doc.periodText ? ` — ${doc.periodText}` : ""}`,
      academicYear: doc.identity.academicYear || undefined,
      metaLines: [
        ...(reportNumber ? [{ text: `رقم التقرير: ${reportNumber}`, bold: true }] : []),
        { text: issuedLine },
      ],
      ministryLogo: style.showLogos ? assets.ministryLogo : null,
      schoolLogo: style.showLogos ? assets.schoolLogo : null,
      primaryColor: style.primaryColor,
    },
  };
}

function pageBreakPara(): Paragraph {
  return new Paragraph({ children: [new PageBreak()] });
}

/* ─────────────────── الغلاف والفهرس ─────────────────── */

function coverChildren(
  doc: SnapshotDoc,
  style: StyleConfig,
  reportNumber: string | null,
  assets: InstanceDocxAssets,
): Paragraph[] {
  const out: Paragraph[] = [];
  if (style.showIdentity && style.showLogos && assets.schoolLogo) {
    // شعار الغلاف كما في `.cover-logo` — احتواء بلا تشويه بحد أقصى 110px ارتفاعاً
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 1200, after: 240 },
        children: [
          new ImageRun({
            type: assets.schoolLogo.type,
            data: assets.schoolLogo.data,
            transformation: fitImage(assets.schoolLogo, 220, 110),
            altText: { title: "شعار المدرسة", description: "شعار المدرسة", name: "شعار المدرسة" },
          }),
        ],
      }),
    );
  }
  if (style.showIdentity) {
    doc.identity.orgLines.forEach((line, i) => {
      out.push(centeredPara(line, { bold: i === doc.identity.orgLines.length - 1 }));
    });
  }
  out.push(
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { before: 1600, after: 600 },
      children: [new TextRun({ text: doc.title, rightToLeft: true, bold: true, size: 52, color: docxColor(style.primaryColor) })],
    }),
  );
  out.push(centeredPara(doc.typeLabel));
  if (doc.periodText) out.push(centeredPara(`الفترة: ${doc.periodText}`));
  if (reportNumber) out.push(centeredPara(`رقم التقرير: ${reportNumber}`, { bold: true }));
  out.push(centeredPara(`تاريخ الإصدار: ${doc.generatedAtText}`));
  if (style.showIdentity && doc.identity.academicYear) out.push(centeredPara(`العام الدراسي: ${doc.identity.academicYear}`));
  out.push(pageBreakPara());
  return out;
}

/**
 * الفهرس قائمة ثابتة مرقّمة لا حقل `TableOfContents` عمداً: اللقطة مجمّدة فالقائمة لا
 * يمكن أن تنحرف عن المحتوى، والحقل يطالب المستخدم بتحديث الحقول عند كل فتح للملف —
 * سلوك غير حتمي بلا مقابل. (القائمة تطابق فهرس HTML: أقسام اللقطة بترتيبها.)
 */
function tocChildren(doc: SnapshotDoc, style: StyleConfig): Paragraph[] {
  return [
    sectionHeading("المحتويات", style.primaryColor, style.accentColor),
    ...doc.sections.map((s, i) => rtlPara(`${i + 1}. ${s.label}`)),
    pageBreakPara(),
  ];
}

/* ─────────────────── جداول البيانات ─────────────────── */

function sectionChildren(
  section: SnapshotSection,
  index: number,
  style: StyleConfig,
  layoutFontScale: number,
  splitAt: number | null,
): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [sectionHeading(`${index + 1}. ${section.label}`, style.primaryColor, style.accentColor)];
  if (section.filterLines.length) {
    out.push(metaPara(section.filterLines.map(([k, v]) => `${k}: ${v}`).join(" · ")));
  }
  out.push(metaPara(`عدد الصفوف: ${section.total}`));
  if (section.truncated) {
    out.push(rtlPara("اقتُطع القسم عند حدّه الأقصى — ضيّق المرشّحات ليكتمل.", { size: META_SIZE, color: "8A6D00" }));
  }
  if (section.empty) {
    out.push(metaPara("لا بيانات مطابقة للمرشّحات في هذا القسم."));
    return out;
  }
  // حجم خط الجدول بأنصاف النقاط من معامل التصغير المحكوم نفسه المستعمل في HTML/PDF،
  // وكثافة القالب تتحكم في هوامش الخلايا الأصلية
  const size = Math.round((style.density === "مضغوط" ? 20 : 22) * layoutFontScale);
  const groups = splitAt ? splitColumns(section.columns, splitAt) : [section.columns];
  groups.forEach((cols, gi) => {
    if (groups.length > 1) out.push(metaPara(`جزء ${gi + 1} من ${groups.length} — العمود الأول مكرر للربط`));
    out.push(
      officialWordTable({
        header: cols.map((c) => c.label),
        rows: section.rows.map((r) => cols.map((c) => cellText(r[c.key], c.type))),
        size,
        density: style.density,
      }),
    );
  });
  return out;
}

function attachmentsChildren(doc: SnapshotDoc, style: StyleConfig): (Paragraph | Table)[] {
  return [
    sectionHeading(`${doc.sections.length + 1}. الشواهد والمرفقات المستعملة`, style.primaryColor, style.accentColor),
    officialWordTable({
      header: ["م", "المرفق", "المصدر"],
      rows: doc.attachments.map((a, i) => [String(i + 1), a.name, a.source]),
      size: 22,
      density: style.density,
    }),
  ];
}

/* ─────────────────── التجميع — مقاطع Word باتجاهات مختلطة ─────────────────── */

type Bucket = { orientation: "portrait" | "landscape"; children: (Paragraph | Table)[] };

/**
 * البناء الفعلي من لقطة وأصول صور محمّلة مسبقاً — تفصله الدالة العامة كي تختبره
 * الاختبارات الحتمية بأصول في الذاكرة بلا قاعدة ولا تخزين.
 */
export async function buildInstanceDocx(
  doc: SnapshotDoc,
  opts: { reportNumber?: string | null },
  assets: InstanceDocxAssets,
): Promise<Buffer> {
  const style = styleOf(doc);
  const reportNumber = opts.reportNumber ?? null;

  const front: (Paragraph | Table)[] = [];
  // ختم المسودة: التقرير غير المعتمد لا يُشبه وثيقة صادرة (يقابل `.draft-stamp` في HTML)
  if (!reportNumber) {
    front.push(centeredPara("مسودة — غير معتمدة", { bold: true, size: 36, color: "B42828" }));
  }
  if (wantsCover(doc, style)) front.push(...coverChildren(doc, style, reportNumber, assets));
  if (wantsToc(doc, style)) front.push(...tocChildren(doc, style));

  // كل تتابُع أقسام بالاتجاه نفسه يُجمع في مقطع Word واحد؛ تغيّر الاتجاه يفتح مقطعاً
  // جديداً بحجم صفحته — القسم العريض أفقي والباقي رأسي، لا قصّ صامتاً أبداً (§F)
  const buckets: Bucket[] = [{ orientation: "portrait", children: front }];
  doc.sections.forEach((section, i) => {
    const layout = tableLayoutFor(section.columns.length);
    const last = buckets[buckets.length - 1];
    if (layout.orientation !== last.orientation) {
      if (last.children.length === 0) last.orientation = layout.orientation;
      else buckets.push({ orientation: layout.orientation, children: [] });
    }
    buckets[buckets.length - 1].children.push(...sectionChildren(section, i, style, layout.fontScale, layout.splitAt));
  });

  // الذيل — المرفقات ثم الاعتماد — رأسي دائماً كما في المصيّر HTML
  const tail: (Paragraph | Table)[] = [];
  if (doc.attachments.length) tail.push(...attachmentsChildren(doc, style));
  if (style.approvalBox) {
    // خانة الاعتماد الرسمية: حقول مستوى المدير فقط — المسمى والاسم والتاريخ والتوقيع
    // والختم. اللقطة المجمّدة لا تحمل أصول توقيع/ختم فتبقى مساحتا التوقيع والختم للتعبئة
    tail.push(approvalSpacer());
    tail.push(
      approvalArea({
        principalTitle: doc.identity.principalTitle || "مدير المدرسة",
        principalName: doc.identity.principalName || undefined,
        signature: null,
        stamp: null,
      }),
    );
  }
  if (tail.length) {
    const last = buckets[buckets.length - 1];
    if (last.orientation === "portrait") last.children.push(...tail);
    else buckets.push({ orientation: "portrait", children: tail });
  }

  const model = headerModel(doc, style, reportNumber, assets);
  const header: Header = model.kind === "official" ? officialWordHeader(model.opts) : plainWordHeader(model.opts);
  const footerText = style.footerText || (style.showIdentity ? doc.identity.footerNote : "");
  const footer: Footer = officialWordFooter(footerText);

  // حجز حزام الترويسة: الهامش العلوي = مسافة الترويسة + ارتفاعها المقدَّر من محتواها
  // الفعلي + وسادة — نفسه لكل المقاطع رأسيةً وأفقيةً فتتطابق الحزمة على كل الصفحات،
  // وجدول المتابعة لا يبدأ داخل الترويسة أبداً (عيب بوابة fade36f)
  const headerHeight =
    model.kind === "official" ? officialHeaderHeightTwips(model.opts) : plainHeaderHeightTwips(model.opts);
  const margins = officialPageMargins(headerHeight, {
    plain: model.kind === "plain",
    hasFooterText: Boolean(footerText),
  });

  const word = new Document({
    // D-040: خط عربي مطابق لخط PDF المضمن — وورد يستبدل تلقائياً إن لم يكن مثبتاً
    styles: officialDocStyles(style.primaryColor),
    sections: buckets.map((bucket, i) => ({
      properties: {
        page: {
          size: {
            orientation: bucket.orientation === "landscape" ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
          },
          margin: margins,
        },
      },
      // الترويسة والتذييل على المقطع الأول فقط — بقية المقاطع (رأسية وأفقية) ترثهما
      // بدلالة OOXML فتتكرر الترويسة على كل صفحة بلا تكرار في المتن
      ...(i === 0 ? { headers: { default: header }, footers: { default: footer } } : {}),
      children: bucket.children,
    })),
  });

  return Buffer.from(await Packer.toBuffer(word));
}

export async function instanceDocx(doc: SnapshotDoc, opts: { reportNumber?: string | null }): Promise<Buffer> {
  const style = styleOf(doc);
  // الشعارات من التخزين المحلي الآمن فقط وعند طلب القالب لها — الغائب/المتعذر يسقط
  // بصمت وتبقى الهوية النصية (لا يفشل التوليد بسبب شعار)
  const [ministryLogo, schoolLogo] =
    style.showIdentity && style.showLogos
      ? await Promise.all([
          loadWordImageAsset(doc.identity.ministryLogoFileId),
          loadWordImageAsset(doc.identity.schoolLogoFileId),
        ])
      : [null, null];
  return buildInstanceDocx(doc, opts, { ministryLogo, schoolLogo });
}

import "server-only";
import AdmZip from "adm-zip";

/**
 * حزمة ZIP للتقرير المحفوظ (v2.6 §G) — تجميع وتحقق، دوال خالصة تُختبر وحدوياً.
 *
 * الحزمة مسطّحة عمداً: لا مجلدات داخلها فلا معنى لفواصل مسار في أسماء المداخل، وكل
 * اسم يمرّ بمُطهِّر يمنع `..` ومحارف التحكم ومحارف ويندوز الممنوعة (نمط `safeFileName`
 * في سلامة التصدير نفسه). وبعد التجميع يُقرأ الأرشيف قرينةً على سلامته قبل التسليم —
 * ملف معطوب يُكتشف هنا لا على جهاز المدير.
 */

export type ZipPart = { name: string; data: Buffer };

/**
 * اسم مدخل آمن وفريد داخل الحزمة: بلا فواصل مسار ولا `..` ولا محارف تحكم ولا محارف
 * ويندوز الممنوعة، يُبقي العربية، ولا يخرج فارغاً. عند التكرار تُقحم لاحقة « (2)» قبل
 * الامتداد. الدالة تضيف الاسم المختار إلى `taken` فيتراكم الحجز عبر الاستدعاءات.
 */
export function zipEntryName(desired: string, taken: Set<string>): string {
  const cleaned = desired
    // فواصل المسار تُستبدل ولا تُحذف حتى لا يلتحم مقطعان في اسم مضلِّل
    .replace(/[/\\]/g, "-")
    // `..` يمنع أي تفسير مساري للاسم عند فك الضغط
    .replace(/\.{2,}/g, "-")
    // محارف التحكم تُحذف: تُستعمل لتزوير الأسماء المعروضة
    .replace(/[\x00-\x1f\x7f]/g, "")
    // محارف ممنوعة في أسماء ملفات ويندوز
    .replace(/["*:<>?|]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^[-\s.]+|[-\s.]+$/g, "")
    .trim()
    .slice(0, 120);
  const base = cleaned || "ملف";
  // اللاحقة تُقحم قبل الامتداد حتى يبقى الملف مفتوحاً ببرنامجه الصحيح
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  let candidate = base;
  for (let n = 2; taken.has(candidate); n++) candidate = `${stem} (${n})${ext}`;
  taken.add(candidate);
  return candidate;
}

/** تجميع الأجزاء في أرشيف واحد — الأسماء يجهّزها المستدعي بـ`zipEntryName` */
export function assembleZip(parts: ZipPart[]): Buffer {
  const zip = new AdmZip();
  for (const part of parts) zip.addFile(part.name, part.data);
  return zip.toBuffer();
}

/**
 * فحص سلامة الحزمة (§G): يُقرأ الأرشيف من جديد ويُتحقق أن كل مدخل متوقع موجود وقابل
 * للاستخراج بطول مطابق لما في ترويسته، وألا يحمل أي مدخل فاصل مسار أو `..` — أرشيف
 * لا يجتاز الفحص لا يُسلَّم.
 */
export function verifyZip(data: Buffer, expectedNames: string[]): boolean {
  try {
    const zip = new AdmZip(data);
    const entries = new Map(zip.getEntries().map((e) => [e.entryName, e]));
    for (const name of entries.keys()) {
      if (name.includes("/") || name.includes("\\") || name.includes("..")) return false;
    }
    for (const name of expectedNames) {
      const entry = entries.get(name);
      if (!entry) return false;
      // `getData` يفكّ الضغط ويفحص CRC — العطب يظهر رمياً أو بطول لا يطابق الترويسة
      const bytes = entry.getData();
      if (!bytes || bytes.length !== entry.header.size) return false;
    }
    return true;
  } catch {
    return false;
  }
}

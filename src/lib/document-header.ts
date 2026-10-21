import "server-only";
import { getDocumentIdentity, resolveHeader, type IdentityToggles, type DocumentIdentity, type ResolvedHeader } from "@/lib/document-identity";
import { readStoredFile } from "@/lib/storage";
import { loadWordImageAsset } from "@/lib/reports/word-design";
import type { WordHeader } from "@/lib/reports/word-export";
import type { PageHeaderIdentity } from "@/lib/pdf";

/**
 * الترويسة الرسمية الموحّدة (v2.3 §8) — نقطة واحدة تستدعيها كل مولدات الوثائق:
 * تقرأ هوية الوثائق المركزية (اسم المدير ومسماه والشعارات من الإعدادات — لا شيء
 * ثابت في الشيفرة)، وتحمّل الشعارات ملفات محلية مخزّنة كـ data URIs —
 * لا جلب من الشبكة إطلاقاً وقت التوليد.
 */

export type OfficialHeader = PageHeaderIdentity & {
  resolved: ResolvedHeader;
};

async function fileToDataUri(fileId: string | null): Promise<string | null> {
  if (!fileId) return null;
  try {
    const stored = await readStoredFile(fileId);
    if (!stored) return null;
    return `data:${stored.file.mime};base64,${stored.data.toString("base64")}`;
  } catch {
    // شعار متعذر القراءة لا يمنع إصدار الوثيقة — يسقط بصمت وتبقى الترويسة نصية
    return null;
  }
}

/**
 * v2.4 §15: ترويسة وورد من الهوية المركزية نفسها — تستدعيها كل مسارات تصدير DOCX.
 * منذ إعادة تصميم v2.6 تحمل أيضاً ألوان الهوية والشعارات وأصلي التوقيع والختم متى
 * فعّلتها ضوابط التضمين — محمّلة من التخزين المحلي الآمن فقط، والمتعذر يسقط بصمت.
 */
export async function getWordHeader(): Promise<WordHeader> {
  const identity = await getDocumentIdentity();
  const resolved = resolveHeader(identity);
  const [ministryLogo, schoolLogo, signature, stamp] = await Promise.all([
    loadWordImageAsset(resolved.ministryLogoFileId),
    loadWordImageAsset(resolved.schoolLogoFileId),
    loadWordImageAsset(resolved.signatureFileId),
    loadWordImageAsset(resolved.stampFileId),
  ]);
  return {
    orgLines: resolved.orgLines,
    principalName: resolved.principalName || undefined,
    principalTitle: resolved.principalTitle || undefined,
    academicYear: resolved.academicYear || undefined,
    headerNote: resolved.headerNote || undefined,
    footerNote: resolved.footerNote || undefined,
    contactInfo: resolved.contactInfo || undefined,
    primaryColor: resolved.primaryColor,
    accentColor: resolved.accentColor,
    ministryLogo,
    schoolLogo,
    signature,
    stamp,
  };
}

export async function getOfficialHeader(opts?: {
  toggles?: Partial<IdentityToggles>;
  overrides?: Partial<DocumentIdentity>;
}): Promise<OfficialHeader> {
  const identity = await getDocumentIdentity();
  const resolved = resolveHeader(identity, opts?.toggles, opts?.overrides);
  const [ministryLogoDataUri, schoolLogoDataUri] = await Promise.all([
    fileToDataUri(resolved.ministryLogoFileId),
    fileToDataUri(resolved.schoolLogoFileId),
  ]);
  return {
    resolved,
    orgLines: resolved.orgLines,
    headerNote: resolved.headerNote || undefined,
    footerNote: resolved.footerNote || undefined,
    principalName: resolved.principalName || undefined,
    academicYear: resolved.academicYear || undefined,
    signerTitle: resolved.principalTitle || undefined,
    ministryLogoDataUri: ministryLogoDataUri ?? undefined,
    schoolLogoDataUri: schoolLogoDataUri ?? undefined,
  };
}

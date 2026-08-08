import "server-only";
import { getSetting, setSetting } from "@/lib/settings";

/**
 * هوية الوثائق المركزية (النطاق §6).
 *
 * قيم افتراضية عامة واحدة تُستعمل في كل الوثائق المولّدة، مع ضبط تضمين/استبعاد لكل عنصر
 * وإمكان تجاوز لكل وثيقة. الوثيقة المُصدَرة تحفظ لقطة HTML ثابتة (`documents.html_snapshot`)
 * تلتقط القيم المستعملة وقت الإصدار، فلا يتأثر المُصدَر بتغيّر الإعدادات لاحقاً.
 *
 * التخزين في جدول `settings` (مفتاح/قيمة) — لا حاجة لهجرة.
 */

const KEY = "document.identity";

export type DocumentIdentity = {
  ministryName: string;
  educationDepartment: string;
  /** مهجور — D-057 أخرجه من العرض نهائياً؛ يبقى الحقل لتوافق الإعدادات المخزّنة القديمة ولا يقرؤه أحد */
  educationOffice: string;
  schoolName: string;
  principalName: string;
  /** المسمى الوظيفي للموقّع — مركزي لا يُكرر في المولدات (v2.3 §8) */
  principalTitle: string;
  academicYear: string;
  gregorianYear: string;
  headerNote: string;
  footerNote: string;
  /** بيانات الاتصال المركزية (هاتف/بريد/عنوان) — تظهر في ترويسة الوثائق (v2.6 §E) */
  contactInfo: string;
  /** ألوان الهوية (v2.6 §E) — مركزية لكل الوثائق والتقارير المولّدة */
  primaryColor: string;
  accentColor: string;
  /** معرّفات ملفات مخزّنة للشعارات والتوقيع والختم (اختيارية) */
  ministryLogoFileId: string | null;
  schoolLogoFileId: string | null;
  signatureFileId: string | null;
  stampFileId: string | null;
};

/**
 * القيم الافتراضية الرسمية الحالية للمجمع — تبقى كما كانت قبل مركزة الهوية.
 * اسم المدير يبقى فارغاً حتى يُدخله المدير من إعدادات هوية الوثائق —
 * لا اسم شخصياً في الشيفرة (v2.3 §8).
 */
export const DEFAULT_IDENTITY: DocumentIdentity = {
  ministryName: "المملكة العربية السعودية — وزارة التعليم",
  educationDepartment: "إدارة التعليم في محافظة صبيا",
  // D-057: «إدارة التعليم» هي الجهة المخاطَبة — الحقل المهجور يبقى فارغاً ولا يُصيَّر
  educationOffice: "",
  schoolName: "مجمع الخشعة التعليمي للبنين",
  principalName: "",
  principalTitle: "مدير مجمع الخشعة للبنين",
  academicYear: "1448-1449هـ",
  gregorianYear: "2026-2027م",
  headerNote: "",
  footerNote: "منصة الإدارة المدرسية المتكاملة",
  contactInfo: "",
  primaryColor: "#1f5244",
  accentColor: "#348066",
  ministryLogoFileId: null,
  schoolLogoFileId: null,
  signatureFileId: null,
  stampFileId: null,
};

/** عناصر الهوية القابلة للتضمين/الاستبعاد في كل وثيقة. */
export type IdentityToggles = {
  ministryLogo: boolean;
  schoolLogo: boolean;
  ministryName: boolean;
  educationDepartment: boolean;
  schoolName: boolean;
  principalName: boolean;
  academicYear: boolean;
  headerNote: boolean;
  footerNote: boolean;
  signature: boolean;
  stamp: boolean;
};

export const DEFAULT_TOGGLES: IdentityToggles = {
  ministryLogo: true,
  schoolLogo: true,
  ministryName: true,
  educationDepartment: true,
  schoolName: true,
  principalName: true,
  academicYear: true,
  headerNote: true,
  footerNote: true,
  signature: false,
  stamp: false,
};

/** لون سداسي عشري صالح (v2.6 §E) — أي قيمة أخرى مخزّنة تسقط إلى اللون الافتراضي */
const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

function safeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_COLOR.test(value) ? value : fallback;
}

export async function getDocumentIdentity(): Promise<DocumentIdentity> {
  const stored = await getSetting<Partial<DocumentIdentity> | null>(KEY, null);
  return { ...DEFAULT_IDENTITY, ...(stored ?? {}) };
}

export async function saveDocumentIdentity(patch: Partial<DocumentIdentity>, updatedBy?: string): Promise<DocumentIdentity> {
  const current = await getDocumentIdentity();
  const next = { ...current, ...patch };
  await setSetting(KEY, next, updatedBy);
  return next;
}

/**
 * يبني القيم الفعلية للترويسة بعد تطبيق التضمين/الاستبعاد والتجاوزات لكل وثيقة.
 * النتيجة هي ما يُحقن في `officialPageHtml` ويُجمّد ضمن لقطة الوثيقة.
 */
export function resolveHeader(
  identity: DocumentIdentity,
  toggles: Partial<IdentityToggles> = {},
  overrides: Partial<DocumentIdentity> = {},
): ResolvedHeader {
  const t = { ...DEFAULT_TOGGLES, ...toggles };
  const v = { ...identity, ...overrides };
  // D-057: «إدارة التعليم» هي الجهة المخاطَبة — لا سطر للمكتب في الترويسة
  const orgLines = [
    t.ministryName ? v.ministryName : null,
    t.educationDepartment ? v.educationDepartment : null,
    t.schoolName ? v.schoolName : null,
  ].filter((x): x is string => !!x && x.trim() !== "");

  return {
    orgLines,
    schoolName: t.schoolName ? v.schoolName : "",
    principalName: t.principalName ? v.principalName : "",
    principalTitle: t.principalName ? v.principalTitle : "",
    academicYear: t.academicYear ? v.academicYear : "",
    headerNote: t.headerNote ? v.headerNote : "",
    footerNote: t.footerNote ? v.footerNote : "",
    contactInfo: v.contactInfo ?? "",
    primaryColor: safeColor(v.primaryColor, DEFAULT_IDENTITY.primaryColor),
    accentColor: safeColor(v.accentColor, DEFAULT_IDENTITY.accentColor),
    showSignature: t.signature,
    showStamp: t.stamp,
    ministryLogoFileId: t.ministryLogo ? v.ministryLogoFileId : null,
    schoolLogoFileId: t.schoolLogo ? v.schoolLogoFileId : null,
    signatureFileId: t.signature ? v.signatureFileId : null,
    stampFileId: t.stamp ? v.stampFileId : null,
  };
}

export type ResolvedHeader = {
  orgLines: string[];
  schoolName: string;
  principalName: string;
  principalTitle: string;
  academicYear: string;
  headerNote: string;
  footerNote: string;
  /** بيانات الاتصال المعروضة — من الهوية المركزية أو تجاوز الوثيقة (v2.6 §E) */
  contactInfo: string;
  /** ألوان الهوية (v2.6 §E) — بعد التحقق من صلاحيتها كلون سداسي عشري */
  primaryColor: string;
  accentColor: string;
  showSignature: boolean;
  showStamp: boolean;
  ministryLogoFileId: string | null;
  schoolLogoFileId: string | null;
  signatureFileId: string | null;
  stampFileId: string | null;
};

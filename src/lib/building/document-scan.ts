import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { evidenceItems, evidenceLinks, storedFiles, floors, rooms, assets, maintenanceIssues, inspections, school } from "@/db/schema";
import { saveUploadedFile } from "@/lib/storage";
import { htmlToPdf } from "@/lib/pdf";
import { audit } from "@/lib/audit";

/**
 * Phase 4 — مسح المستندات بالجوال إلى PDF وإرفاقه بكيان المبنى.
 * توليد PDF محلي بالكامل عبر متصفح Playwright (لا خدمة سحابية/ذكاء خارجي إطلاقاً).
 * الملف يُحفظ حساساً (خاص) ويُنزَّل عبر المسار المصادق فقط ويُدقَّق.
 */

export const SCAN_TARGETS = {
  building: "المبنى العام",
  floor: "دور",
  room: "غرفة",
  asset: "أصل",
  inspection: "فحص",
  maintenance: "بلاغ صيانة",
} as const;

export type ScanTargetType = keyof typeof SCAN_TARGETS;

export function isScanTarget(v: string): v is ScanTargetType {
  return v in SCAN_TARGETS;
}

/**
 * يحل معرّف الكيان الفعلي. «المبنى العام» ليس له صف مستقل فنربطه بسجل المدرسة (صف واحد)
 * لأن evidence_links.entity_id من نوع uuid ولا يقبل نصاً حرّاً.
 */
export async function resolveEntityId(type: ScanTargetType, entityId: string): Promise<string | null> {
  if (type !== "building") return entityId;
  const [s] = await db.select({ id: school.id }).from(school).limit(1);
  return s?.id ?? null;
}

/** يتحقق أن الكيان الهدف موجود فعلاً (عدا «المبنى العام» الذي لا يتطلب معرّفاً). */
export async function validateTarget(type: ScanTargetType, entityId: string): Promise<boolean> {
  switch (type) {
    case "building":
      return true;
    case "floor":
      return (await db.select({ id: floors.id }).from(floors).where(eq(floors.id, entityId))).length > 0;
    case "room":
      return (await db.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, entityId))).length > 0;
    case "asset":
      return (await db.select({ id: assets.id }).from(assets).where(eq(assets.id, entityId))).length > 0;
    case "inspection":
      return (await db.select({ id: inspections.id }).from(inspections).where(eq(inspections.id, entityId))).length > 0;
    case "maintenance":
      return (await db.select({ id: maintenanceIssues.id }).from(maintenanceIssues).where(eq(maintenanceIssues.id, entityId))).length > 0;
  }
}

/** يبني PDF بصفحة A4 لكل صورة ملتقطة (data URL: JPEG/PNG). */
export async function buildScanPdf(pageDataUrls: string[], title: string): Promise<Buffer> {
  const pages = pageDataUrls
    .map(
      (src) =>
        `<div style="page-break-after:always;height:100%;display:flex;align-items:center;justify-content:center;">
           <img src="${src}" style="max-width:100%;max-height:100%;object-fit:contain;" alt=""/>
         </div>`,
    )
    .join("");
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
    <style>@page{size:A4;margin:6mm} html,body{margin:0;padding:0} img{display:block}</style>
    <title>${title}</title></head><body>${pages}</body></html>`;
  return htmlToPdf(html, { pageNumbers: true });
}

/**
 * يحفظ PDF المسح كملف حساس، وينشئ شاهداً (kind=file) ويربطه بالكيان الهدف، ويدقّق.
 * يعيد معرّف الشاهد والملف.
 */
export async function attachScannedDocument(opts: {
  pdf: Buffer;
  title: string;
  category: string | null;
  targetType: ScanTargetType;
  entityId: string;
  sensitive: boolean;
  actorId: string;
}): Promise<{ evidenceId: string; fileId: string }> {
  const safeTitle = opts.title.trim().slice(0, 200) || "مستند ممسوح";
  const file = await saveUploadedFile({
    originalName: `${safeTitle}.pdf`,
    mime: "application/pdf",
    data: opts.pdf,
    scope: "attachments",
    sensitive: opts.sensitive,
    uploadedBy: opts.actorId,
  });
  const [evidence] = await db
    .insert(evidenceItems)
    .values({
      title: safeTitle,
      kind: "file",
      fileId: file.id,
      evidenceType: opts.category ?? "مستند ممسوح",
      source: "مسح مستند",
      origin: "ورقي",
      createdBy: opts.actorId,
    })
    .returning();
  await db.insert(evidenceLinks).values({
    evidenceId: evidence.id,
    entityType: opts.targetType,
    entityId: opts.entityId,
    linkedBy: opts.actorId,
  });
  await audit({
    actorId: opts.actorId,
    action: "document.scanned",
    entityType: opts.targetType,
    entityId: opts.entityId,
    summary: `${safeTitle}${opts.category ? ` — ${opts.category}` : ""}${opts.sensitive ? " (حساس)" : ""}`,
  });
  return { evidenceId: evidence.id, fileId: file.id };
}

/** المستندات الممسوحة المرفقة (لعرضها في صفحة المستندات). */
export async function listScannedDocuments(limit = 50) {
  const links = await db
    .select()
    .from(evidenceLinks)
    .where(inArray(evidenceLinks.entityType, Object.keys(SCAN_TARGETS)))
    .orderBy(desc(evidenceLinks.createdAt))
    .limit(limit);
  if (links.length === 0) return [];
  const evIds = links.map((l) => l.evidenceId);
  const items = await db
    .select()
    .from(evidenceItems)
    .where(and(inArray(evidenceItems.id, evIds), eq(evidenceItems.source, "مسح مستند")));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const fileIds = items.map((i) => i.fileId).filter((x): x is string => !!x);
  const files = fileIds.length ? await db.select().from(storedFiles).where(inArray(storedFiles.id, fileIds)) : [];
  const fileById = new Map(files.map((f) => [f.id, f]));
  return links
    .map((l) => {
      const it = itemById.get(l.evidenceId);
      if (!it) return null;
      const f = it.fileId ? fileById.get(it.fileId) : null;
      return {
        evidenceId: it.id,
        title: it.title,
        category: it.evidenceType,
        targetType: l.entityType as ScanTargetType,
        entityId: l.entityId,
        fileId: it.fileId,
        sensitive: f?.sensitive ?? false,
        createdAt: l.createdAt,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

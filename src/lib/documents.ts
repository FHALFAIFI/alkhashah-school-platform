import "server-only";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { audit } from "@/lib/audit";

/**
 * إصدار وثيقة برقم فريد ورمز تحقق ولقطة HTML ثابتة.
 *
 * اللقطة (`htmlSnapshot`) هي المرجع الأبدي للوثيقة: تُحفظ كما صُيّرت لحظة الإصدار ولا
 * يُعاد توليدها أبداً. لذلك تغيير قالب لاحقاً — أو تغيير هوية المدرسة أو أي إعداد — لا
 * يمسّ أي وثيقة صادرة (v2.2 §E5).
 *
 * `templateVersionId` أثر تدقيقي يجيب «بأي نسخة قالب صدرت؟» ولا يُستعمل في العرض.
 */
export async function issueDocument(opts: {
  docType: string;
  title: string;
  entityType?: string;
  entityId?: string;
  htmlSnapshot: string;
  pdfFileId?: string;
  withSignature?: boolean;
  withStamp?: boolean;
  templateVersionId?: string | null;
  issuedBy: string;
}) {
  const prefix = await getSetting("documents.number_prefix", "KHS-DOC-");
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(documents);
  const docNumber = `${prefix}${String(count + 1).padStart(5, "0")}`;
  const verificationCode = randomBytes(4).toString("hex").toUpperCase();

  const [doc] = await db
    .insert(documents)
    .values({
      docNumber,
      verificationCode,
      docType: opts.docType,
      title: opts.title,
      entityType: opts.entityType,
      entityId: opts.entityId,
      htmlSnapshot: opts.htmlSnapshot,
      pdfFileId: opts.pdfFileId,
      withSignature: opts.withSignature ?? false,
      withStamp: opts.withStamp ?? false,
      templateVersionId: opts.templateVersionId ?? null,
      issuedBy: opts.issuedBy,
    })
    .returning();

  await audit({
    actorId: opts.issuedBy,
    action: "document.issued",
    entityType: "document",
    entityId: doc.id,
    summary: `إصدار وثيقة ${docNumber} — ${opts.title}`,
    detail: { withSignature: opts.withSignature, withStamp: opts.withStamp },
  });
  if (opts.withSignature || opts.withStamp) {
    await audit({
      actorId: opts.issuedBy,
      action: "branding.used",
      entityType: "document",
      entityId: doc.id,
      summary: `استخدام ${opts.withSignature ? "التوقيع" : ""}${opts.withSignature && opts.withStamp ? " و" : ""}${opts.withStamp ? "الختم" : ""} في ${docNumber}`,
    });
  }
  return doc;
}

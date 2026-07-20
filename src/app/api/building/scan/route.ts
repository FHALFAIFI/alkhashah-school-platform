import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, requireCsrf, AuthError } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rate-limit";
import {
  buildScanPdf,
  attachScannedDocument,
  validateTarget,
  isScanTarget,
  resolveEntityId,
} from "@/lib/building/document-scan";
import { validateUpload, saveUploadedFile } from "@/lib/storage";
import { db } from "@/db";
import { evidenceItems, evidenceLinks } from "@/db/schema";
import { audit } from "@/lib/audit";

/**
 * Phase 4 — استقبال مسح المستند (صور من الكاميرا) أو رفع ملف بديل، وبناء PDF محلياً
 * وإرفاقه بكيان المبنى كشاهد حساس. لا يُرسل أي محتوى إلى خدمة خارجية.
 */

const MAX_PAGES = 30;

function canScan(user: { permissions: Set<string> }): boolean {
  return (
    user.permissions.has("building.write") ||
    user.permissions.has("inspections.write") ||
    user.permissions.has("maintenance.write") ||
    user.permissions.has("assets.write")
  );
}

const jsonSchema = z.object({
  pages: z.array(z.string().startsWith("data:image/")).min(1).max(MAX_PAGES),
  title: z.string().trim().min(1).max(200),
  category: z.string().trim().max(100).optional(),
  targetType: z.string(),
  entityId: z.string().trim().max(64),
  sensitive: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
  if (!canScan(user)) return NextResponse.json({ error: "لا تملك صلاحية إرفاق مستندات المبنى" }, { status: 403 });
  try {
    await requireCsrf(user);
  } catch {
    return NextResponse.json({ error: "رمز الحماية غير صالح — أعد تحميل الصفحة" }, { status: 403 });
  }
  if (!rateLimit(`scan:${user.id}`, 30)) {
    return NextResponse.json({ error: "معدل مرتفع — انتظر قليلاً" }, { status: 429 });
  }

  const contentType = req.headers.get("content-type") ?? "";

  try {
    // مسار الكاميرا: JSON بصفحات صور
    if (contentType.includes("application/json")) {
      const body = jsonSchema.safeParse(await req.json());
      if (!body.success) return NextResponse.json({ error: "بيانات المسح ناقصة أو غير صالحة" }, { status: 400 });
      const { pages, title, category, targetType, entityId, sensitive } = body.data;
      if (!isScanTarget(targetType)) return NextResponse.json({ error: "نوع الكيان غير معروف" }, { status: 400 });
      if (!(await validateTarget(targetType, entityId)))
        return NextResponse.json({ error: "الكيان الهدف غير موجود" }, { status: 404 });
      const eid = await resolveEntityId(targetType, entityId);
      if (!eid) return NextResponse.json({ error: "تعذّر تحديد الكيان الهدف" }, { status: 400 });

      const pdf = await buildScanPdf(pages, title);
      const res = await attachScannedDocument({
        pdf,
        title,
        category: category ?? null,
        targetType,
        entityId: eid,
        sensitive: sensitive ?? true,
        actorId: user.id,
      });
      return NextResponse.json({ ok: true, ...res, title });
    }

    // مسار الرفع البديل: ملف (PDF مباشرة أو صورة تُغلَّف في PDF)
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      const title = String(form.get("title") ?? "").trim();
      const category = String(form.get("category") ?? "").trim() || null;
      const targetType = String(form.get("targetType") ?? "");
      const entityId = String(form.get("entityId") ?? "").trim();
      const sensitive = String(form.get("sensitive") ?? "true") !== "false";
      if (!(file instanceof File)) return NextResponse.json({ error: "لم يُرفق ملف" }, { status: 400 });
      if (!title) return NextResponse.json({ error: "عنوان المستند مطلوب" }, { status: 400 });
      if (!isScanTarget(targetType)) return NextResponse.json({ error: "نوع الكيان غير معروف" }, { status: 400 });
      if (!(await validateTarget(targetType, entityId)))
        return NextResponse.json({ error: "الكيان الهدف غير موجود" }, { status: 404 });
      const eid = await resolveEntityId(targetType, entityId);
      if (!eid) return NextResponse.json({ error: "تعذّر تحديد الكيان الهدف" }, { status: 400 });

      const buf = Buffer.from(await file.arrayBuffer());
      const mime = file.type || "application/octet-stream";
      const err = validateUpload(file.name || "upload", mime, buf.length);
      if (err) return NextResponse.json({ error: err }, { status: 400 });

      if (mime === "application/pdf") {
        // احفظ PDF كما هو وأرفقه (لا نعيد بناءه)
        const saved = await saveUploadedFile({
          originalName: `${title.slice(0, 200)}.pdf`,
          mime: "application/pdf",
          data: buf,
          scope: "attachments",
          sensitive,
          uploadedBy: user.id,
        });
        const [evidence] = await db
          .insert(evidenceItems)
          .values({ title: title.slice(0, 200), kind: "file", fileId: saved.id, evidenceType: category ?? "مستند مرفوع", source: "مسح مستند", origin: "رقمي", createdBy: user.id })
          .returning();
        await db.insert(evidenceLinks).values({ evidenceId: evidence.id, entityType: targetType, entityId: eid, linkedBy: user.id });
        await audit({ actorId: user.id, action: "document.scanned", entityType: targetType, entityId: eid, summary: `${title} (رفع ملف)` });
        return NextResponse.json({ ok: true, evidenceId: evidence.id, fileId: saved.id, title });
      }

      if (mime.startsWith("image/")) {
        const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
        const pdf = await buildScanPdf([dataUrl], title);
        const res = await attachScannedDocument({ pdf, title, category, targetType, entityId: eid, sensitive, actorId: user.id });
        return NextResponse.json({ ok: true, ...res, title });
      }

      return NextResponse.json({ error: "نوع الملف غير مدعوم — ارفع PDF أو صورة" }, { status: 400 });
    }

    return NextResponse.json({ error: "نوع الطلب غير مدعوم" }, { status: 415 });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("scan route error:", e);
    return NextResponse.json({ error: "تعذر إنشاء المستند — حاول مجدداً" }, { status: 500 });
  }
}

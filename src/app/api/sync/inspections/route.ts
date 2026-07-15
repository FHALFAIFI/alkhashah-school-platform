import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { inspections, rooms, floors, siteZones, inspectionTemplates } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { saveUploadedFile } from "@/lib/storage";

/**
 * مزامنة فحوصات وضع عدم الاتصال — idempotent عبر clientOpId:
 * إعادة الإرسال لا تنشئ سجلات مكررة (A13).
 */

const opSchema = z.object({
  clientOpId: z.string().min(8).max(100),
  roomId: z.string().uuid(),
  templateId: z.string().uuid(),
  inspectedAt: z.string(),
  results: z.array(z.object({ key: z.string(), ok: z.boolean(), note: z.string().optional() })),
  notes: z.string().optional(),
  photosBase64: z.array(z.object({ name: z.string(), mime: z.string(), data: z.string() })).max(5).optional(),
});

const bodySchema = z.object({ ops: z.array(opSchema).max(200) });

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
  if (!user.permissions.has("inspections.write")) {
    return NextResponse.json({ error: "لا تملك صلاحية الفحص" }, { status: 403 });
  }
  const csrf = req.headers.get("x-csrf-token");
  if (!csrf || csrf !== user.csrfToken) {
    return NextResponse.json({ error: "رمز الحماية غير صالح" }, { status: 403 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "بيانات غير صالحة" }, { status: 400 });
  }

  const applied: string[] = [];
  const skipped: string[] = [];
  const failed: { clientOpId: string; error: string }[] = [];

  for (const op of body.ops) {
    try {
      // الحارس: الغرفة في المنطقة المدارة فقط
      const [room] = await db.select().from(rooms).where(eq(rooms.id, op.roomId));
      if (!room) {
        failed.push({ clientOpId: op.clientOpId, error: "الغرفة غير موجودة" });
        continue;
      }
      const [floor] = await db.select().from(floors).where(eq(floors.id, room.floorId));
      const [zone] = await db.select().from(siteZones).where(eq(siteZones.key, floor.zoneKey));
      if (zone && zone.zoneType === "context") {
        failed.push({ clientOpId: op.clientOpId, error: "منطقة سياق فقط" });
        continue;
      }
      const [template] = await db.select().from(inspectionTemplates).where(eq(inspectionTemplates.id, op.templateId));
      if (!template || template.status !== "معتمد") {
        failed.push({ clientOpId: op.clientOpId, error: "القالب غير معتمد" });
        continue;
      }

      const photoIds: string[] = [];
      for (const p of op.photosBase64 ?? []) {
        const stored = await saveUploadedFile({
          originalName: p.name,
          mime: p.mime,
          data: Buffer.from(p.data, "base64"),
          scope: "attachments",
          uploadedBy: user.id,
        });
        photoIds.push(stored.id);
      }

      const inserted = await db
        .insert(inspections)
        .values({
          clientOpId: op.clientOpId,
          roomId: op.roomId,
          templateId: op.templateId,
          inspectionDate: new Date(op.inspectedAt),
          results: op.results,
          photos: photoIds,
          notes: op.notes || null,
          inspectorId: user.id,
        })
        .onConflictDoNothing({ target: inspections.clientOpId })
        .returning({ id: inspections.id });

      if (inserted.length > 0) applied.push(op.clientOpId);
      else skipped.push(op.clientOpId); // مزامن مسبقاً — لا تكرار
    } catch (e) {
      failed.push({ clientOpId: op.clientOpId, error: e instanceof Error ? e.message : "خطأ" });
    }
  }

  if (applied.length > 0) {
    await audit({
      actorId: user.id,
      action: "inspections.synced",
      summary: `مزامنة ${applied.length} فحصاً من وضع عدم الاتصال (متخطى: ${skipped.length})`,
    });
  }
  return NextResponse.json({ applied, skipped, failed });
}

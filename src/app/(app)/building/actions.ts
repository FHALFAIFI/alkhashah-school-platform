"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  floors, floorGeometryVersions, floorBackgrounds, rooms, assets, assetHistory,
  inspectionTemplates, inspections, maintenanceIssues, readinessOverrides, siteZones,
} from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { saveUploadedFile } from "@/lib/storage";
import { validateGeometry, roomArea, roomPerimeter, round1, type FloorGeometry } from "@/lib/building/geometry";
import { nextRoomCode, nextAssetCode, nextMaintenanceCode } from "@/lib/building/codes";

export type ActionState = { error?: string; success?: string } | null;

/** حارس منطقة البنات: لا غرف ولا أصول ولا سجلات في منطقة السياق */
async function assertManagedZone(floorId: string): Promise<string | null> {
  const [floor] = await db.select().from(floors).where(eq(floors.id, floorId));
  if (!floor) return "الدور غير موجود";
  const [zone] = await db.select().from(siteZones).where(eq(siteZones.key, floor.zoneKey));
  if (zone && zone.zoneType === "context") {
    return "هذه المنطقة سياق جغرافي فقط (مجمع البنات) — لا تقبل غرفاً أو أصولاً أو سجلات";
  }
  return null;
}

// ————————————————— الهندسة —————————————————

/** حفظ مسودة هندسة جديدة — نسخة جديدة دائماً، التاريخ لا يفقد */
export async function saveGeometryDraftAction(floorId: string, geometryJson: string): Promise<ActionState> {
  const user = await requirePermission("building.write");
  const zoneError = await assertManagedZone(floorId);
  if (zoneError) return { error: zoneError };
  let geometry: FloorGeometry;
  try {
    geometry = JSON.parse(geometryJson);
  } catch {
    return { error: "بيانات الهندسة غير صالحة" };
  }
  const check = validateGeometry(geometry);
  if (!check.ok) return { error: check.errors.join("؛ ") };

  const [latest] = await db
    .select()
    .from(floorGeometryVersions)
    .where(eq(floorGeometryVersions.floorId, floorId))
    .orderBy(desc(floorGeometryVersions.version))
    .limit(1);
  const version = (latest?.version ?? 0) + 1;
  await db.insert(floorGeometryVersions).values({
    floorId,
    version,
    geometry: geometry as object,
    status: "مسودة",
    createdBy: user.id,
  });
  await audit({ actorId: user.id, action: "geometry.draft_saved", entityType: "floor", entityId: floorId, summary: `مسودة هندسة نسخة ${version}` });
  revalidatePath("/building");
  return { success: `حفظت مسودة النسخة ${version}` };
}

/** نشر نسخة هندسة: أرشفة المنشورة السابقة + مزامنة سجل الغرف (بلا حذف سجلات) */
export async function publishGeometryAction(versionId: string): Promise<ActionState> {
  const user = await requirePermission("building.publish");
  const [version] = await db.select().from(floorGeometryVersions).where(eq(floorGeometryVersions.id, versionId));
  if (!version) return { error: "النسخة غير موجودة" };
  if (version.status === "منشورة") return { error: "النسخة منشورة مسبقاً" };
  const zoneError = await assertManagedZone(version.floorId);
  if (zoneError) return { error: zoneError };

  const geometry = version.geometry as unknown as FloorGeometry;
  const check = validateGeometry(geometry);
  if (!check.ok) return { error: check.errors.join("؛ ") };

  await db.transaction(async (tx) => {
    await tx
      .update(floorGeometryVersions)
      .set({ status: "مؤرشفة" })
      .where(and(eq(floorGeometryVersions.floorId, version.floorId), eq(floorGeometryVersions.status, "منشورة")));
    await tx
      .update(floorGeometryVersions)
      .set({ status: "منشورة", publishedAt: new Date() })
      .where(eq(floorGeometryVersions.id, versionId));

    // مزامنة سجل الغرف: إنشاء/تحديث حسب مفتاح الهندسة، وتعطيل ما أزيل
    const existing = await tx.select().from(rooms).where(eq(rooms.floorId, version.floorId));
    const byKey = new Map(existing.map((r) => [r.geomKey, r]));
    const seen = new Set<string>();
    for (const gr of geometry.rooms) {
      seen.add(gr.key);
      const room = byKey.get(gr.key);
      const dims = {
        nameAr: gr.name,
        roomType: gr.type,
        lengthM: String(round1(gr.w)),
        widthM: String(round1(gr.h)),
        areaM2: String(roomArea(gr)),
        perimeterM: String(roomPerimeter(gr)),
        active: true,
        updatedAt: new Date(),
      };
      if (room) {
        await tx.update(rooms).set(dims).where(eq(rooms.id, room.id));
      } else {
        const code = await nextRoomCode();
        await tx.insert(rooms).values({ floorId: version.floorId, geomKey: gr.key, code, ...dims });
      }
    }
    for (const r of existing) {
      if (!seen.has(r.geomKey)) {
        await tx.update(rooms).set({ active: false, updatedAt: new Date() }).where(eq(rooms.id, r.id));
      }
    }
  });

  await audit({ actorId: user.id, action: "geometry.published", entityType: "floor", entityId: version.floorId, summary: `نشر هندسة النسخة ${version.version}` });
  revalidatePath("/building");
  return { success: `نشرت النسخة ${version.version} وزومن سجل الغرف` };
}

/** تحديث تحويل الخلفية — لا يمس الهندسة المتجهة إطلاقاً (A12) */
export async function updateBackgroundTransformAction(backgroundId: string, transformJson: string): Promise<ActionState> {
  const user = await requirePermission("building.write");
  let transform: Record<string, number | boolean>;
  try {
    transform = JSON.parse(transformJson);
  } catch {
    return { error: "بيانات التحويل غير صالحة" };
  }
  await db.update(floorBackgrounds).set({ transform }).where(eq(floorBackgrounds.id, backgroundId));
  await audit({ actorId: user.id, action: "background.transformed", entityType: "floor_background", entityId: backgroundId });
  revalidatePath("/building");
  return null;
}

/** استبدال الخلفية بصورة جديدة — الهندسة المتجهة تبقى كما هي */
export async function replaceBackgroundAction(floorId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("building.write");
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "اختر صورة" };
  try {
    const stored = await saveUploadedFile({
      originalName: file.name,
      mime: file.type || "image/png",
      data: Buffer.from(await file.arrayBuffer()),
      scope: "backgrounds",
      uploadedBy: user.id,
    });
    await db.update(floorBackgrounds).set({ active: false }).where(eq(floorBackgrounds.floorId, floorId));
    await db.insert(floorBackgrounds).values({
      floorId,
      fileId: stored.id,
      transform: { x: 0, y: 0, scale: 0.05, rotation: 0, opacity: 0.6, visible: true },
      label: file.name,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذر الرفع" };
  }
  await audit({ actorId: user.id, action: "background.replaced", entityType: "floor", entityId: floorId, summary: "استبدال الخلفية دون مساس بالهندسة" });
  revalidatePath("/building");
  return { success: "استبدلت الخلفية — الهندسة المتجهة لم تتغير" };
}

// ————————————————— الأصول —————————————————

const assetSchema = z.object({
  nameAr: z.string().min(2, "اسم الأصل مطلوب"),
  category: z.string().optional(),
  roomId: z.string().uuid("اختر الغرفة"),
  important: z.string().optional(),
  serialNumber: z.string().optional(),
  quantity: z.coerce.number().int().min(1).default(1),
  condition: z.enum(["ممتازة", "جيدة", "تحتاج صيانة", "خارج الخدمة"]).default("جيدة"),
  notes: z.string().optional(),
});

export async function createAssetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("assets.write");
  const parsed = assetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const [room] = await db.select().from(rooms).where(eq(rooms.id, parsed.data.roomId));
  if (!room) return { error: "الغرفة غير موجودة" };
  const zoneError = await assertManagedZone(room.floorId);
  if (zoneError) return { error: zoneError };

  const important = parsed.data.important === "on";
  const code = await nextAssetCode();
  const [asset] = await db
    .insert(assets)
    .values({
      code,
      nameAr: parsed.data.nameAr,
      category: parsed.data.category || null,
      roomId: parsed.data.roomId,
      important,
      serialNumber: important ? parsed.data.serialNumber || null : null,
      quantity: important ? 1 : parsed.data.quantity,
      condition: parsed.data.condition,
      notes: parsed.data.notes || null,
    })
    .returning();
  await db.insert(assetHistory).values({ assetId: asset.id, event: "إنشاء", detail: `أضيف في ${room.nameAr}`, actorId: user.id });
  await audit({ actorId: user.id, action: "asset.created", entityType: "asset", entityId: asset.id, summary: `${code} — ${asset.nameAr}` });
  revalidatePath("/building/assets");
  return { success: `أضيف الأصل ${code}` };
}

export async function updateAssetConditionAction(assetId: string, formData: FormData): Promise<void> {
  const user = await requirePermission("assets.write");
  const condition = String(formData.get("condition") ?? "جيدة");
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId));
  if (!asset) return;
  if (asset.condition !== condition) {
    await db.update(assets).set({ condition, updatedAt: new Date() }).where(eq(assets.id, assetId));
    await db.insert(assetHistory).values({ assetId, event: "تغيير حالة", detail: `${asset.condition} ← ${condition}`, actorId: user.id });
    await audit({ actorId: user.id, action: "asset.condition_changed", entityType: "asset", entityId: assetId });
  }
  revalidatePath("/building/assets");
}

// ————————————————— قوالب الفحص والفحص —————————————————

export async function approveInspectionTemplateAction(templateId: string): Promise<ActionState> {
  const user = await requirePermission("inspections.write", "building.publish");
  const [t] = await db.select().from(inspectionTemplates).where(eq(inspectionTemplates.id, templateId));
  if (!t) return { error: "القالب غير موجود" };
  await db
    .update(inspectionTemplates)
    .set({ status: "معتمد", approvedBy: user.id, approvedAt: new Date() })
    .where(eq(inspectionTemplates.id, templateId));
  await audit({ actorId: user.id, action: "inspection_template.approved", entityType: "inspection_template", entityId: templateId });
  revalidatePath("/building/inspections");
  return { success: "اعتمد القالب" };
}

const inspectionSchema = z.object({
  roomId: z.string().uuid(),
  templateId: z.string().uuid(),
  notes: z.string().optional(),
});

export async function submitInspectionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("inspections.write");
  const parsed = inspectionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "بيانات الفحص ناقصة" };
  const [room] = await db.select().from(rooms).where(eq(rooms.id, parsed.data.roomId));
  if (!room) return { error: "الغرفة غير موجودة" };
  const zoneError = await assertManagedZone(room.floorId);
  if (zoneError) return { error: zoneError };
  const [template] = await db.select().from(inspectionTemplates).where(eq(inspectionTemplates.id, parsed.data.templateId));
  if (!template || template.status !== "معتمد") return { error: "القالب غير معتمد" };

  const results = template.items.map((item) => ({
    key: item.key,
    ok: formData.get(`item_${item.key}`) === "ok",
    note: String(formData.get(`note_${item.key}`) ?? "") || undefined,
  }));

  await db.insert(inspections).values({
    roomId: parsed.data.roomId,
    templateId: parsed.data.templateId,
    results,
    notes: parsed.data.notes || null,
    inspectorId: user.id,
  });
  await audit({ actorId: user.id, action: "inspection.submitted", entityType: "room", entityId: parsed.data.roomId, summary: `فحص ${room.nameAr}` });
  revalidatePath("/building/inspections");
  revalidatePath(`/building/rooms/${parsed.data.roomId}`);
  return { success: "سجل الفحص" };
}

/** تجاوز الجاهزية — سبب إلزامي */
export async function overrideReadinessAction(roomId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("inspections.write", "building.publish");
  const value = Math.max(0, Math.min(100, Number(formData.get("value") ?? 0)));
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 5) return { error: "سبب التجاوز إلزامي (5 أحرف على الأقل)" };
  await db.insert(readinessOverrides).values({ roomId, overrideValue: value, reason, actorId: user.id });
  await audit({ actorId: user.id, action: "readiness.overridden", entityType: "room", entityId: roomId, summary: `تجاوز الجاهزية إلى ${value}٪ — ${reason}` });
  revalidatePath(`/building/rooms/${roomId}`);
  return { success: "سجل التجاوز بسببه" };
}

// ————————————————— الصيانة —————————————————

const issueSchema = z.object({
  title: z.string().min(3, "عنوان البلاغ مطلوب"),
  description: z.string().optional(),
  roomId: z.string().uuid().optional().or(z.literal("")),
  assetId: z.string().uuid().optional().or(z.literal("")),
  priority: z.enum(["عالية", "متوسطة", "منخفضة"]).default("متوسطة"),
});

export async function createIssueAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("maintenance.write");
  const parsed = issueSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (parsed.data.roomId) {
    const [room] = await db.select().from(rooms).where(eq(rooms.id, parsed.data.roomId));
    if (room) {
      const zoneError = await assertManagedZone(room.floorId);
      if (zoneError) return { error: zoneError };
    }
  }
  const photos: string[] = [];
  const photo = formData.get("photo") as File | null;
  if (photo && photo.size > 0) {
    const stored = await saveUploadedFile({
      originalName: photo.name,
      mime: photo.type || "image/jpeg",
      data: Buffer.from(await photo.arrayBuffer()),
      scope: "attachments",
      uploadedBy: user.id,
    });
    photos.push(stored.id);
  }
  const code = await nextMaintenanceCode();
  const [issue] = await db
    .insert(maintenanceIssues)
    .values({
      code,
      title: parsed.data.title,
      description: parsed.data.description || null,
      roomId: parsed.data.roomId || null,
      assetId: parsed.data.assetId || null,
      priority: parsed.data.priority,
      photos,
      reportedBy: user.id,
    })
    .returning();
  await audit({ actorId: user.id, action: "maintenance.created", entityType: "maintenance", entityId: issue.id, summary: `${code} — ${issue.title}` });
  revalidatePath("/building/maintenance");
  return { success: `سجل البلاغ ${code}` };
}

export async function updateIssueStatusAction(issueId: string, formData: FormData): Promise<void> {
  const user = await requirePermission("maintenance.write");
  const status = String(formData.get("status") ?? "مفتوح");
  const repairNote = String(formData.get("repairNote") ?? "");
  const [issue] = await db.select().from(maintenanceIssues).where(eq(maintenanceIssues.id, issueId));
  if (!issue) return;
  const patch: Record<string, unknown> = { status, updatedAt: new Date() };
  if (repairNote) patch.repairNote = repairNote;
  if (status === "مغلق ومتحقق") {
    patch.closedAt = new Date();
    patch.verifiedBy = user.id;
    patch.verifiedAt = new Date();
  }
  await db.update(maintenanceIssues).set(patch).where(eq(maintenanceIssues.id, issueId));
  await audit({ actorId: user.id, action: "maintenance.status_changed", entityType: "maintenance", entityId: issueId, summary: `${issue.code} → ${status}` });
  revalidatePath("/building/maintenance");
}

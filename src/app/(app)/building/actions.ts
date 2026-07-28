"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  floors, floorGeometryVersions, floorBackgrounds, rooms, assets, assetHistory,
  inspectionTemplates, inspections, maintenanceIssues, people, readinessOverrides, siteZones,
} from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { saveUploadedFile } from "@/lib/storage";
import { validateGeometry, applyRoomEditToGeometry, roomArea, roomPerimeter, round1, type FloorGeometry } from "@/lib/building/geometry";
import { nextRoomCode, nextAssetCode, nextMaintenanceCode, findRoomByCode } from "@/lib/building/codes";
import { getAssetDependencies, ASSET_EVENT } from "@/lib/building/asset-lifecycle";
import { ASSET_DELETE_CONFIRM } from "@/lib/building/asset-constants";
import { orFallback } from "@/lib/format";
import { userFacingError } from "@/lib/user-error";

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

// ————————————————— الغرف —————————————————

const roomUpdateSchema = z.object({
  // Optional per v2.1 global rule — empty name/type stored as "" (NOT-NULL column satisfied).
  nameAr: z.string().trim().max(120).optional(),
  roomType: z.string().trim().max(60).optional(),
  lengthM: z.coerce.number().min(0).max(200).optional(),
  widthM: z.coerce.number().min(0).max(200).optional(),
  capacity: z.coerce.number().int().min(0).max(10000).optional(),
  notes: z.string().trim().max(2000).optional(),
});

/**
 * تعديل الحقول البسيطة للغرفة — مصدر حقيقة واحد:
 * في معاملة واحدة يحدث سجل الغرف ويكتب الاسم/النوع/الأبعاد نفسها في هندسة الدور
 * كمسودة (يحدث آخر نسخة إن كانت مسودة، وإلا ينشئ مسودة جديدة). النشر لاحقاً يزامن
 * السجل من الهندسة فلا يعود يمسح التعديلات.
 */
export async function updateRoomAction(roomId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("building.write");
  const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId));
  if (!room) return { error: "الغرفة غير موجودة" };
  const zoneError = await assertManagedZone(room.floorId);
  if (zoneError) return { error: zoneError };

  const parsed = roomUpdateSchema.safeParse({
    nameAr: formData.get("nameAr"),
    roomType: formData.get("roomType"),
    lengthM: formData.get("lengthM") || undefined,
    widthM: formData.get("widthM") || undefined,
    capacity: formData.get("capacity") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  const d = parsed.data;

  const lengthM = d.lengthM ?? (room.lengthM ? Number(room.lengthM) : undefined);
  const widthM = d.widthM ?? (room.widthM ? Number(room.widthM) : undefined);

  const geometrySync = await db.transaction(async (tx) => {
    await tx
      .update(rooms)
      .set({
        nameAr: d.nameAr ?? "",
        roomType: d.roomType ?? "",
        lengthM: lengthM != null ? String(round1(lengthM)) : room.lengthM,
        widthM: widthM != null ? String(round1(widthM)) : room.widthM,
        areaM2: lengthM != null && widthM != null ? String(round1(lengthM * widthM)) : room.areaM2,
        perimeterM: lengthM != null && widthM != null ? String(round1(2 * (lengthM + widthM))) : room.perimeterM,
        capacity: d.capacity ?? room.capacity,
        notes: d.notes ?? room.notes,
        updatedAt: new Date(),
      })
      .where(eq(rooms.id, roomId));

    // مزامنة التعديل نفسه في هندسة الدور — حتى يظهر الاسم على المخطط ولا يمسح النشر التعديل
    const [latest] = await tx
      .select()
      .from(floorGeometryVersions)
      .where(eq(floorGeometryVersions.floorId, room.floorId))
      .orderBy(desc(floorGeometryVersions.version))
      .limit(1);
    if (!latest) return { synced: false as const };

    const updated = applyRoomEditToGeometry(latest.geometry as unknown as FloorGeometry, room.geomKey, {
      name: d.nameAr ?? "",
      type: d.roomType ?? "",
      lengthM,
      widthM,
    });
    if (!updated) return { synced: false as const };

    if (latest.status === "مسودة") {
      await tx
        .update(floorGeometryVersions)
        .set({ geometry: updated as object, note: `مزامنة تعديل الغرفة ${room.code}` })
        .where(eq(floorGeometryVersions.id, latest.id));
      return { synced: true as const, version: latest.version };
    }
    const version = latest.version + 1;
    await tx.insert(floorGeometryVersions).values({
      floorId: room.floorId,
      version,
      geometry: updated as object,
      status: "مسودة",
      note: `مزامنة تعديل الغرفة ${room.code}`,
      createdBy: user.id,
    });
    return { synced: true as const, version };
  });

  await audit({ actorId: user.id, action: "room.updated", entityType: "room", entityId: roomId, summary: `تعديل بيانات الغرفة ${room.code}${geometrySync.synced ? ` + مسودة مخطط نسخة ${geometrySync.version}` : ""}` });
  revalidatePath(`/building/rooms/${roomId}`);
  revalidatePath("/building");
  return {
    success: geometrySync.synced
      ? `حُفظت بيانات الغرفة وسجل التعديل في مسودة المخطط (نسخة ${geometrySync.version})`
      : "حُفظت بيانات الغرفة",
  };
}

/** فتح غرفة بالرمز المطبوع — بديل يدوي لمسح QR يعمل عبر HTTP دون كاميرا */
export async function openRoomByCodeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("building.read");
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { error: "أدخل رمز الغرفة (مثال: KHS-RM-0007)" };
  const room = await findRoomByCode(code);
  if (!room) return { error: `لا غرفة بالرمز «${code}» — تحقق من الرمز المطبوع` };
  redirect(`/building/rooms/${room.id}`);
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
  const warn = check.warnings.length > 0 ? ` — تنبيهات: ${check.warnings.join("؛ ")}` : "";
  return { success: `حفظت مسودة النسخة ${version}${warn}` };
}

/**
 * تراجع موثق إلى نسخة سابقة — يُنشئ **نسخة جديدة** من هندسة النسخة الهدف (لا يعدّل أي نسخة
 * قائمة) بسبب إلزامي مسجّل، ثم يراجعها المدير وينشرها. يحفظ المحرّر والوقت والسبب.
 */
export async function rollbackGeometryAction(versionId: string, reason: string): Promise<ActionState> {
  const user = await requirePermission("building.write");
  if (!reason || reason.trim().length < 5) return { error: "سبب التراجع إلزامي (5 أحرف على الأقل)" };
  const [target] = await db.select().from(floorGeometryVersions).where(eq(floorGeometryVersions.id, versionId));
  if (!target) return { error: "النسخة غير موجودة" };
  const zoneError = await assertManagedZone(target.floorId);
  if (zoneError) return { error: zoneError };
  const [latest] = await db
    .select()
    .from(floorGeometryVersions)
    .where(eq(floorGeometryVersions.floorId, target.floorId))
    .orderBy(desc(floorGeometryVersions.version))
    .limit(1);
  const version = (latest?.version ?? 0) + 1;
  await db.insert(floorGeometryVersions).values({
    floorId: target.floorId,
    version,
    geometry: target.geometry as object,
    status: "مسودة",
    createdBy: user.id,
    note: `تراجع موثق إلى النسخة ${target.version}: ${reason.trim()}`,
  });
  await audit({ actorId: user.id, action: "geometry.rolled_back", entityType: "floor", entityId: target.floorId, summary: `تراجع موثق إلى النسخة ${target.version} (نسخة جديدة ${version}) — ${reason.trim()}` });
  revalidatePath("/building");
  return { success: `أنشئت مسودة نسخة ${version} من النسخة ${target.version} — راجعها ثم انشرها` };
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
        // تمرير المعاملة إلزامي هنا حتى يرى العد الغرف المدرجة في المعاملة نفسها
        const code = await nextRoomCode(tx);
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
    return { error: userFacingError(e, "تعذر الرفع") };
  }
  await audit({ actorId: user.id, action: "background.replaced", entityType: "floor", entityId: floorId, summary: "استبدال الخلفية دون مساس بالهندسة" });
  revalidatePath("/building");
  return { success: "استبدلت الخلفية — الهندسة المتجهة لم تتغير" };
}

// ————————————————— الأصول —————————————————

const assetSchema = z.object({
  // Optional per v2.1 global rule — empty name stored as "" (NOT-NULL column satisfied).
  nameAr: z.string().optional(),
  category: z.string().optional(),
  // Structural FK kept required — an asset must belong to a room.
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

  // منع تكرار الأصول: نفس الرقم التسلسلي (إن وُجد) أو نفس الاسم في الغرفة نفسها
  const serial = parsed.data.serialNumber?.trim();
  if (serial) {
    const [dupSerial] = await db.select({ code: assets.code }).from(assets).where(and(eq(assets.serialNumber, serial), eq(assets.active, true))).limit(1);
    if (dupSerial) return { error: `أصل بالرقم التسلسلي «${serial}» مسجل مسبقاً (${dupSerial.code})` };
  }
  // فحص التكرار بالاسم يُتخطى للاسم الفارغ (الاسم أصبح اختيارياً)
  const nameAr = parsed.data.nameAr?.trim() ?? "";
  if (nameAr) {
    const [dupName] = await db
      .select({ code: assets.code })
      .from(assets)
      .where(and(eq(assets.roomId, parsed.data.roomId), eq(assets.nameAr, nameAr), eq(assets.active, true)))
      .limit(1);
    if (dupName) return { error: `أصل باسم «${nameAr}» مسجل مسبقاً في هذه الغرفة (${dupName.code})` };
  }

  const important = parsed.data.important === "on";
  const code = await nextAssetCode();
  const [asset] = await db
    .insert(assets)
    .values({
      code,
      nameAr,
      category: parsed.data.category || null,
      roomId: parsed.data.roomId,
      important,
      serialNumber: important ? parsed.data.serialNumber || null : null,
      quantity: important ? 1 : parsed.data.quantity,
      condition: parsed.data.condition,
      notes: parsed.data.notes || null,
    })
    .returning();
  await db.insert(assetHistory).values({ assetId: asset.id, event: "إنشاء", detail: `أضيف في ${orFallback(room.nameAr)}`, actorId: user.id });
  await audit({ actorId: user.id, action: "asset.created", entityType: "asset", entityId: asset.id, summary: `${code} — ${orFallback(asset.nameAr)}` });
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

// ————————————————— دورة حياة الأصل: أرشفة / استعادة / حذف نهائي —————————————————

/**
 * أرشفة الأصل — الإجراء الافتراضي غير المدمّر. يخفيه من القوائم التشغيلية (active=false)
 * ويحفظ سبباً عربياً إلزامياً؛ يبقى كل شيء (الفحوصات، الصيانة، سجل الغرفة، رمز QR،
 * سجل التدقيق) على حاله وقابلاً للاستعادة. يسجّل القيمة قبل/بعد في سجل التدقيق.
 */
export async function archiveAssetAction(assetId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("assets.write");
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 3) return { error: "اذكر سبب الأرشفة (٣ أحرف على الأقل)" };
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId));
  if (!asset) return { error: "الأصل غير موجود" };
  if (!asset.active && asset.archivedAt) return { error: "الأصل مؤرشف بالفعل" };

  const now = new Date();
  await db
    .update(assets)
    .set({ active: false, archivedAt: now, archivedReason: reason, archivedBy: user.id, updatedAt: now })
    .where(eq(assets.id, assetId));
  await db.insert(assetHistory).values({ assetId, event: ASSET_EVENT.archived, detail: reason, actorId: user.id });
  await audit({
    actorId: user.id,
    action: "asset.archived",
    entityType: "asset",
    entityId: assetId,
    summary: `${asset.code} — ${orFallback(asset.nameAr)}`,
    detail: { before: { active: asset.active }, after: { active: false, archivedReason: reason } },
  });
  revalidatePath("/building/assets");
  return { success: `أُرشف الأصل ${asset.code} — يمكن استعادته في أي وقت` };
}

/** استعادة الأصل المؤرشف إلى القوائم التشغيلية (يعكس الأرشفة، non-destructive). */
export async function restoreAssetAction(assetId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("assets.write");
  void formData;
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId));
  if (!asset) return { error: "الأصل غير موجود" };
  if (asset.active) return { error: "الأصل نشط بالفعل" };

  const now = new Date();
  await db
    .update(assets)
    .set({ active: true, archivedAt: null, archivedReason: null, archivedBy: null, updatedAt: now })
    .where(eq(assets.id, assetId));
  await db.insert(assetHistory).values({ assetId, event: ASSET_EVENT.restored, detail: null, actorId: user.id });
  await audit({
    actorId: user.id,
    action: "asset.restored",
    entityType: "asset",
    entityId: assetId,
    summary: `${asset.code} — ${orFallback(asset.nameAr)}`,
    detail: { before: { active: false }, after: { active: true } },
  });
  revalidatePath("/building/assets");
  return { success: `استُعيد الأصل ${asset.code}` };
}

/**
 * الحذف النهائي — متاح فقط للأصل المُنشأ بالخطأ وبلا أي تبعية، وبعد كتابة عبارة التأكيد
 * «حذف الأصل نهائياً» حرفياً وإقرار أنه أُنشئ بالخطأ. يُحظر من الخادم عند وجود تبعيات
 * (بلاغات صيانة/شواهد/وثائق) مع بيان أنواعها وأعدادها بالعربية. لا حذف بالسلسلة لأي
 * سجل أعمال — فقط سجل الأصل نفسه وأثره الداخلي (asset_history) يُزالان في معاملة واحدة.
 */
export async function deleteAssetAction(assetId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("assets.delete");
  const confirm = String(formData.get("confirm") ?? "").trim();
  const createdByMistake = String(formData.get("createdByMistake") ?? "") === "on";
  if (!createdByMistake) return { error: "الحذف النهائي متاح فقط للأصل المُنشأ بالخطأ — أكّد ذلك" };
  if (confirm !== ASSET_DELETE_CONFIRM) return { error: `اكتب عبارة التأكيد حرفياً: «${ASSET_DELETE_CONFIRM}»` };

  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId));
  if (!asset) return { error: "الأصل غير موجود" };

  const deps = await getAssetDependencies(assetId);
  if (deps.length > 0) {
    const list = deps.map((d) => `${d.labelAr} (${d.count})`).join("، ");
    return {
      error: `لا يمكن الحذف النهائي — يوجد سجلات مرتبطة: ${list}. أرشف الأصل بدلاً من حذفه للحفاظ على هذه السجلات.`,
    };
  }

  // معاملة واحدة: احذف الأثر الداخلي ثم سجل الأصل. سجل التدقيق العام (audit_log) يبقى.
  await db.transaction(async (tx) => {
    await tx.delete(assetHistory).where(eq(assetHistory.assetId, assetId));
    await tx.delete(assets).where(eq(assets.id, assetId));
  });
  await audit({
    actorId: user.id,
    action: "asset.deleted",
    entityType: "asset",
    entityId: assetId,
    summary: `${asset.code} — ${orFallback(asset.nameAr)}`,
    detail: { reason: "أُنشئ بالخطأ", snapshot: { code: asset.code, nameAr: asset.nameAr, roomId: asset.roomId } },
  });
  revalidatePath("/building/assets");
  return { success: `حُذف الأصل ${asset.code} نهائياً (لا تبعيات)` };
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
    // تجميد تاريخي: نسخة القالب المستخدَمة الآن — لا تغيّرها تعديلات القالب اللاحقة
    templateSnapshot: template.sections ?? template.items,
    templateVersion: template.version,
  });
  await audit({ actorId: user.id, action: "inspection.submitted", entityType: "room", entityId: parsed.data.roomId, summary: `فحص ${orFallback(room.nameAr)}` });
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
  // Optional per v2.1 global rule — empty title stored as "" (NOT-NULL column satisfied).
  title: z.string().optional(),
  description: z.string().optional(),
  roomId: z.string().uuid().optional().or(z.literal("")),
  assetId: z.string().uuid().optional().or(z.literal("")),
  ownerPersonId: z.string().uuid("اختر المكلف من السجل").optional().or(z.literal("")),
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
  if (parsed.data.ownerPersonId) {
    const [person] = await db.select().from(people).where(eq(people.id, parsed.data.ownerPersonId));
    if (!person || !person.active) return { error: "المكلف بالإصلاح غير موجود في سجل الأشخاص النشطين" };
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
      title: parsed.data.title ?? "",
      description: parsed.data.description || null,
      roomId: parsed.data.roomId || null,
      assetId: parsed.data.assetId || null,
      ownerPersonId: parsed.data.ownerPersonId || null,
      priority: parsed.data.priority,
      photos,
      reportedBy: user.id,
    })
    .returning();
  await audit({ actorId: user.id, action: "maintenance.created", entityType: "maintenance", entityId: issue.id, summary: `${code} — ${orFallback(issue.title)}` });
  revalidatePath("/building/maintenance");
  return { success: `سجل البلاغ ${code}` };
}

const ISSUE_STATUSES = ["مفتوح", "قيد الإصلاح", "تم الإصلاح", "مغلق ومتحقق"] as const;

export async function updateIssueStatusAction(issueId: string, formData: FormData): Promise<void> {
  const user = await requirePermission("maintenance.write");
  const status = String(formData.get("status") ?? "مفتوح");
  if (!ISSUE_STATUSES.includes(status as (typeof ISSUE_STATUSES)[number])) return;
  const repairNote = String(formData.get("repairNote") ?? "").trim();
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

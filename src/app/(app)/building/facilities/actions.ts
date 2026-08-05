"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { facilityChecklist, facilityRoomLinks, rooms } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { orFallback } from "@/lib/format";
import { FACILITY_STATUSES, STANDARD_FACILITIES } from "./constants";

export type ActionState = { error?: string; success?: string } | null;

const addSchema = z.object({
  // Optional per v2.1 global rule — empty type stored as "" (NOT-NULL column satisfied).
  facilityType: z.string().optional(),
  kind: z.enum(["معياري", "مخصص"]).optional(),
  requiredQty: z.coerce.number().int().min(0).optional(),
  notes: z.string().optional(),
});

export async function addFacilityAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("building.write");
  const parsed = addSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const facilityType = d.facilityType?.trim() ?? "";

  const existing = await db.select().from(facilityChecklist);
  // فحص التكرار يُتخطى للنوع الفارغ (نوع المرفق أصبح اختيارياً)
  if (facilityType && existing.some((f) => f.facilityType.trim() === facilityType)) {
    return { error: "هذا المرفق مضاف بالفعل في القائمة" };
  }

  const [row] = await db
    .insert(facilityChecklist)
    .values({
      facilityType,
      kind: d.kind ?? "مخصص",
      requiredQty: d.requiredQty ?? null,
      notes: d.notes || null,
      sortOrder: existing.length,
      createdBy: user.id,
    })
    .returning();
  await audit({ actorId: user.id, action: "facility.added", entityType: "facility", entityId: row.id, summary: `مرفق «${orFallback(facilityType)}»` });
  return { success: "أُضيف المرفق إلى القائمة" };
}

/** بذر القائمة المعيارية دفعةً واحدةً (يتجاهل الموجود). */
export async function seedStandardFacilitiesAction(): Promise<ActionState> {
  const user = await requirePermission("building.write");
  const existing = await db.select().from(facilityChecklist);
  const have = new Set(existing.map((f) => f.facilityType.trim()));
  let added = 0;
  for (const [i, name] of STANDARD_FACILITIES.entries()) {
    if (have.has(name)) continue;
    await db.insert(facilityChecklist).values({ facilityType: name, kind: "معياري", sortOrder: existing.length + i, createdBy: user.id });
    added++;
  }
  await audit({ actorId: user.id, action: "facility.standard_seeded", entityType: "facility", summary: `بذر ${added} مرفقاً معيارياً` });
  return { success: `أُضيف ${added} مرفقاً من القائمة المعيارية` };
}

export async function setFacilityStatusAction(facilityId: string, status: string): Promise<ActionState> {
  const user = await requirePermission("building.write");
  if (!FACILITY_STATUSES.includes(status as (typeof FACILITY_STATUSES)[number])) return { error: "حالة غير معروفة" };
  const [f] = await db.select().from(facilityChecklist).where(eq(facilityChecklist.id, facilityId));
  if (!f) return { error: "المرفق غير موجود" };
  await db.update(facilityChecklist).set({ status, updatedAt: new Date() }).where(eq(facilityChecklist.id, facilityId));
  await audit({ actorId: user.id, action: "facility.status_changed", entityType: "facility", entityId: facilityId, summary: `${orFallback(f.facilityType)}: ${status}` });
  return { success: "حُدّثت الحالة" };
}

export async function linkFacilityRoomAction(facilityId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("building.write");
  const roomId = String(formData.get("roomId") ?? "");
  const [f] = await db.select().from(facilityChecklist).where(eq(facilityChecklist.id, facilityId));
  if (!f) return { error: "المرفق غير موجود" };
  const [room] = await db.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, roomId));
  if (!room) return { error: "اختر غرفة فعلية" };

  await db.insert(facilityRoomLinks).values({ facilityId, roomId }).onConflictDoNothing();
  // ربط غرفة يعني أن المرفق موجود
  if (f.status !== "موجود") {
    await db.update(facilityChecklist).set({ status: "موجود", updatedAt: new Date() }).where(eq(facilityChecklist.id, facilityId));
  }
  await audit({ actorId: user.id, action: "facility.room_linked", entityType: "facility", entityId: facilityId, summary: `ربط غرفة بمرفق ${orFallback(f.facilityType)}` });
  return { success: "رُبطت الغرفة بالمرفق" };
}

export async function unlinkFacilityRoomAction(facilityId: string, roomId: string): Promise<ActionState> {
  const user = await requirePermission("building.write");
  await db
    .delete(facilityRoomLinks)
    .where(and(eq(facilityRoomLinks.facilityId, facilityId), eq(facilityRoomLinks.roomId, roomId)));
  await audit({ actorId: user.id, action: "facility.room_unlinked", entityType: "facility", entityId: facilityId });
  return { success: "فُك ربط الغرفة" };
}

export async function deleteFacilityAction(facilityId: string): Promise<ActionState> {
  const user = await requirePermission("building.write");
  const [f] = await db.select().from(facilityChecklist).where(eq(facilityChecklist.id, facilityId));
  if (!f) return { error: "المرفق غير موجود" };
  // حذف بند القائمة يزيل روابط الغرف (تعاقبي على الربط فقط) — لا يمس الغرف نفسها
  await db.delete(facilityChecklist).where(eq(facilityChecklist.id, facilityId));
  await audit({ actorId: user.id, action: "facility.deleted", entityType: "facility", entityId: facilityId, summary: `حذف مرفق «${orFallback(f.facilityType)}»` });
  return { success: "حُذف المرفق من القائمة" };
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { people, perfCycles, committeeMembers } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

const personSchema = z.object({
  fullName: z.string().min(2, "الاسم مطلوب"),
  category: z.enum(["معلم", "موظف"]),
  jobTitle: z.string().optional(),
  cadre: z.string().optional(),
  employmentStatus: z.string().optional(),
  orgUnit: z.string().optional(),
  jobNumber: z.string().optional(),
  email: z.string().email("بريد غير صالح").optional().or(z.literal("")),
});

export type ActionState = { error?: string; success?: string } | null;

export async function createPersonAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("people.write");
  const parsed = personSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const [p] = await db
    .insert(people)
    .values({ ...parsed.data, email: parsed.data.email || null, createdBy: user.id })
    .returning();
  await audit({ actorId: user.id, action: "person.created", entityType: "person", entityId: p.id, summary: `إضافة ${p.fullName}` });
  revalidatePath("/people");
  redirect(`/people/${p.id}`);
}

export async function updatePersonAction(personId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("people.write");
  const parsed = personSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await db
    .update(people)
    .set({ ...parsed.data, email: parsed.data.email || null, updatedAt: new Date() })
    .where(eq(people.id, personId));
  await audit({ actorId: user.id, action: "person.updated", entityType: "person", entityId: personId, summary: `تعديل بيانات شخص` });
  revalidatePath(`/people/${personId}`);
  return { success: "تم الحفظ" };
}

export async function deactivatePersonAction(personId: string, formData: FormData): Promise<void> {
  const user = await requirePermission("people.write");
  const reason = String(formData.get("reason") ?? "").trim();
  await db
    .update(people)
    .set({ active: false, deactivatedAt: new Date(), deactivateReason: reason || null })
    .where(eq(people.id, personId));
  await audit({ actorId: user.id, action: "person.deactivated", entityType: "person", entityId: personId, summary: `إيقاف شخص${reason ? ` — السبب: ${reason}` : ""}` });
  revalidatePath(`/people/${personId}`);
}

export async function reactivatePersonAction(personId: string): Promise<void> {
  const user = await requirePermission("people.write");
  await db.update(people).set({ active: true, deactivatedAt: null, deactivateReason: null }).where(eq(people.id, personId));
  await audit({ actorId: user.id, action: "person.reactivated", entityType: "person", entityId: personId });
  revalidatePath(`/people/${personId}`);
}

/** الحذف النهائي مسموح فقط عند عدم وجود سجلات مرتبطة — وإلا الأرشفة/الإيقاف */
export async function deletePersonAction(personId: string): Promise<ActionState> {
  const user = await requirePermission("people.delete");
  const [cycle] = await db.select({ id: perfCycles.id }).from(perfCycles).where(eq(perfCycles.personId, personId)).limit(1);
  const [member] = await db.select({ id: committeeMembers.id }).from(committeeMembers).where(eq(committeeMembers.personId, personId)).limit(1);
  if (cycle || member) {
    return { error: "لا يمكن الحذف النهائي: توجد سجلات مرتبطة (أداء أو لجان) — استخدم الإيقاف بدلاً من ذلك" };
  }
  await db.delete(people).where(eq(people.id, personId));
  await audit({ actorId: user.id, action: "person.deleted", entityType: "person", entityId: personId, summary: "حذف نهائي لشخص بلا سجلات مرتبطة" });
  revalidatePath("/people");
  redirect("/people");
}

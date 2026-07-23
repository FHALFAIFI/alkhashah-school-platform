"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { people } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { assessDeletion } from "@/lib/safe-delete";
import { EMPLOYEE_TYPES, categoryForEmployeeType, type EmployeeType } from "@/lib/employee-type";
import { audit } from "@/lib/audit";

const personSchema = z.object({
  fullName: z.string().min(2, "الاسم مطلوب"),
  /** النوع المعتمد في نطاق المنتج؛ `category` المصدري يُشتق منه للصفوف الجديدة. */
  employeeType: z.enum(EMPLOYEE_TYPES),
  jobTitle: z.string().optional(),
  cadre: z.string().optional(),
  employmentStatus: z.string().optional(),
  orgUnit: z.string().optional(),
  jobNumber: z.string().optional(),
  email: z.string().email("بريد غير صالح").optional().or(z.literal("")),
});

export type ActionState = { error?: string; success?: string } | null;

/**
 * كشف التكرار قبل الإضافة/التعديل اليدوي — الرقم الوظيفي هو المعرّف الموثوق،
 * ويُفحص الاسم الكامل كمؤشر ثانوي. يمنع إنشاء منسوب موجود أصلاً في السجل.
 */
async function findDuplicate(
  data: { jobNumber?: string; fullName: string },
  excludeId?: string,
): Promise<{ id: string; fullName: string; reasonAr: string } | null> {
  const notSelf = excludeId ? ne(people.id, excludeId) : undefined;

  const jobNumber = data.jobNumber?.trim();
  if (jobNumber) {
    const [byNumber] = await db
      .select({ id: people.id, fullName: people.fullName })
      .from(people)
      .where(notSelf ? and(eq(people.jobNumber, jobNumber), notSelf) : eq(people.jobNumber, jobNumber))
      .limit(1);
    if (byNumber) {
      return { ...byNumber, reasonAr: `الرقم الوظيفي ${jobNumber} مسجَّل بالفعل للمنسوب «${byNumber.fullName}»` };
    }
  }

  const fullName = data.fullName.trim();
  const [byName] = await db
    .select({ id: people.id, fullName: people.fullName })
    .from(people)
    .where(notSelf ? and(eq(people.fullName, fullName), notSelf) : eq(people.fullName, fullName))
    .limit(1);
  if (byName) return { ...byName, reasonAr: `يوجد منسوب بنفس الاسم «${fullName}» في السجل` };

  return null;
}

export async function createPersonAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("people.write");
  const parsed = personSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { employeeType, ...rest } = parsed.data;

  const dup = await findDuplicate(rest);
  if (dup) return { error: `${dup.reasonAr} — افتح سجله وعدّله بدل إنشاء سجل جديد.` };

  const [p] = await db
    .insert(people)
    .values({
      ...rest,
      employeeType,
      category: categoryForEmployeeType(employeeType as EmployeeType),
      email: rest.email || null,
      createdBy: user.id,
    })
    .returning();
  await audit({ actorId: user.id, action: "person.created", entityType: "person", entityId: p.id, summary: `إضافة ${p.fullName} (${employeeType})` });
  revalidatePath("/people");
  redirect(`/people/${p.id}`);
}

export async function updatePersonAction(personId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("people.write");
  const parsed = personSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { employeeType, ...rest } = parsed.data;

  const dup = await findDuplicate(rest, personId);
  if (dup) return { error: dup.reasonAr };

  // `category` المصدري لا يُعاد كتابته للصفوف المستوردة — يُحدَّث `employee_type` فقط.
  await db
    .update(people)
    .set({ ...rest, employeeType, email: rest.email || null, updatedAt: new Date() })
    .where(eq(people.id, personId));
  await audit({ actorId: user.id, action: "person.updated", entityType: "person", entityId: personId, summary: `تعديل بيانات منسوب (${employeeType})` });
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

/**
 * الحذف النهائي — متاح فقط للمنسوب الذي لم يُشَر إليه في أي سجل قط.
 *
 * الحارس يمر عبر طبقة الحذف الآمن الموحّدة، فيغطي كل مواضع الإشارة (لجان، دورات أداء،
 * مراحل تدريس، مهام، بلاغات صيانة، ملكية برامج، حسابات دخول، شواهد، وثائق صادرة) بدل
 * الفحصين اللذين كانا مطبَّقين. عند وجود أي ارتباط تُشرح التبعيات بالعربية ويُوجَّه
 * المستخدم إلى الإيقاف — ولا تُحذف أي سجلات تاريخية بالسلسلة.
 */
export async function deletePersonAction(personId: string): Promise<ActionState> {
  const user = await requirePermission("people.delete");
  const [person] = await db.select().from(people).where(eq(people.id, personId));
  if (!person) return { error: "المنسوب غير موجود" };

  const assessment = await assessDeletion("person", personId);
  if (assessment.blocked) return { error: assessment.messageAr };

  await db.delete(people).where(eq(people.id, personId));
  await audit({
    actorId: user.id,
    action: "person.deleted",
    entityType: "person",
    entityId: personId,
    summary: `حذف نهائي للمنسوب «${person.fullName}» — لا سجلات مرتبطة`,
    detail: { snapshot: { fullName: person.fullName, category: person.category, jobNumber: person.jobNumber } },
  });
  revalidatePath("/people");
  redirect("/people");
}

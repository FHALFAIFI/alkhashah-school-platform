"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { people } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { assessDeletion } from "@/lib/safe-delete";
import { deletePersonPermanently as purgePerson } from "@/lib/lifecycle-delete";
import { EMPLOYEE_TYPES, categoryForEmployeeType, type EmployeeType } from "@/lib/employee-type";
import { audit } from "@/lib/audit";
import { orFallback } from "@/lib/format";
import { isUuid } from "@/lib/validation";

const personSchema = z.object({
  // Optional per v2.1 global rule — an empty name is stored as "" (NOT-NULL column satisfied).
  fullName: z.string().optional(),
  /**
   * النوع المعتمد في نطاق المنتج؛ `category` المصدري يُشتق منه للصفوف الجديدة.
   * Optional now: an unset/empty value derives to the default type «معلم» (sensible enum default),
   * keeping the D-019 category derivation intact.
   */
  employeeType: z.enum(EMPLOYEE_TYPES).optional().or(z.literal("")),
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
  data: { jobNumber?: string; fullName?: string },
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
      return { ...byNumber, reasonAr: `الرقم الوظيفي ${jobNumber} مسجَّل بالفعل للمنسوب «${orFallback(byNumber.fullName)}»` };
    }
  }

  // اسم فارغ لا يُطابَق ولا يمنع الحفظ (الاسم أصبح اختيارياً)
  const fullName = data.fullName?.trim();
  if (fullName) {
    const [byName] = await db
      .select({ id: people.id, fullName: people.fullName })
      .from(people)
      .where(notSelf ? and(eq(people.fullName, fullName), notSelf) : eq(people.fullName, fullName))
      .limit(1);
    if (byName) return { ...byName, reasonAr: `يوجد منسوب بنفس الاسم «${fullName}» في السجل` };
  }

  return null;
}

export async function createPersonAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("people.write");
  const parsed = personSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { employeeType: rawType, fullName, ...rest } = parsed.data;
  // اشتقاق النوع من قيمة معتمدة أو الافتراضي «معلم» عند تركه فارغاً (D-019)
  const employeeType: EmployeeType = rawType ? rawType : "معلم";

  const dup = await findDuplicate({ ...rest, fullName });
  if (dup) return { error: `${dup.reasonAr} — افتح سجله وعدّله بدل إنشاء سجل جديد.` };

  const [p] = await db
    .insert(people)
    .values({
      ...rest,
      fullName: fullName ?? "",
      employeeType,
      category: categoryForEmployeeType(employeeType),
      email: rest.email || null,
      createdBy: user.id,
    })
    .returning();
  await audit({ actorId: user.id, action: "person.created", entityType: "person", entityId: p.id, summary: `إضافة ${orFallback(p.fullName)} (${employeeType})` });
  revalidatePath("/people");
  redirect(`/people/${p.id}`);
}

export async function updatePersonAction(personId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("people.write");
  const parsed = personSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { employeeType: rawType, fullName, ...rest } = parsed.data;
  const employeeType: EmployeeType = rawType ? rawType : "معلم";

  const dup = await findDuplicate({ ...rest, fullName }, personId);
  if (dup) return { error: dup.reasonAr };

  // `category` المصدري لا يُعاد كتابته للصفوف المستوردة — يُحدَّث `employee_type` فقط.
  await db
    .update(people)
    .set({ ...rest, fullName: fullName ?? "", employeeType, email: rest.email || null, updatedAt: new Date() })
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
    summary: `حذف نهائي للمنسوب «${orFallback(person.fullName)}» — لا سجلات مرتبطة`,
    detail: { snapshot: { fullName: person.fullName, category: person.category, jobNumber: person.jobNumber } },
  });
  revalidatePath("/people");
  redirect("/people");
}

/**
 * «حذف الموظف نهائياً» (v2.4.1 §1.3) — الحذف المقصود لمنسوب **مستخدَم** مع كامل دورة
 * حياته، بخلاف `deletePersonAction` أعلاه المقصور على سجل لم يُستخدم قط.
 *
 * الصلاحية: `people.delete` **و** `performance.individual.read` معاً. الثانية ليست زينة:
 * العملية تمحو محتوى تقييم فردي، ومن لا يملك حق الاطلاع عليه (D-013 — ومنه `sysadmin`)
 * لا يملك حق إتلافه. المدير وحده يجمع الصلاحيتين.
 *
 * كل الحراسات (منع حذف الذات، آخر حساب مخوَّل، الاسم المكتوب حرفياً، السبب الإلزامي)
 * تُفرض على الخادم داخل `lib/lifecycle-delete` — لا في الواجهة.
 */
export async function purgePersonAction(personId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("people.delete", "performance.individual.read");
  if (!isUuid(personId)) return { error: "المنسوب غير موجود" };
  if (String(formData.get("confirm") ?? "") !== "1") return { error: "أكّد الحذف النهائي قبل التنفيذ" };
  const result = await purgePerson({
    personId,
    actorId: user.id,
    reason: String(formData.get("reason") ?? ""),
    typedName: String(formData.get("typedName") ?? ""),
  });
  if (result.error) return result;
  revalidatePath("/people");
  revalidatePath("/performance");
  revalidatePath("/performance/analytics");
  revalidatePath("/committees");
  redirect("/people");
}

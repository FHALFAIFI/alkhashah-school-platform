/**
 * البذرة التجريبية — بيانات عرض اصطناعية بالكامل (أسماء مختلقة، لا بيانات حقيقية).
 * منفصلة تماماً عن البذرة الإنتاجية، وتوسم سجلاتها بوضوح بكلمة «تجريبي».
 * التشغيل: npm run db:seed:demo
 */
import { eq } from "drizzle-orm";
import { db, pool } from "./index";
import { people, planYears, programs, programMilestones } from "./schema";

async function main() {
  const demoTag = "تجريبي";
  const existing = await db.select().from(people).where(eq(people.fullName, `معلم ${demoTag} أول`));
  if (existing.length > 0) {
    console.log("البيانات التجريبية موجودة مسبقاً.");
    await pool.end();
    return;
  }

  await db.insert(people).values([
    { fullName: `معلم ${demoTag} أول`, category: "معلم", jobTitle: "معلم", cadre: "تعليمي", orgUnit: "المرحلة الابتدائية", jobNumber: "900001" },
    { fullName: `معلم ${demoTag} ثانٍ`, category: "معلم", jobTitle: "معلم", cadre: "تعليمي", orgUnit: "المرحلة المتوسطة", jobNumber: "900002" },
    { fullName: `موجه ${demoTag}`, category: "معلم", jobTitle: "موجه طلابي", cadre: "تعليمي", orgUnit: "المجمع", jobNumber: "900003" },
    { fullName: `موظف ${demoTag} إداري`, category: "موظف", jobTitle: "مساعد إداري", cadre: "إداري", orgUnit: "الإدارة", jobNumber: "900004" },
  ]);

  let [year] = await db.select().from(planYears).where(eq(planYears.key, "demo-1448"));
  if (!year) {
    [year] = await db
      .insert(planYears)
      .values({ key: "demo-1448", nameAr: `سنة ${demoTag} 1448/1449هـ` })
      .returning();
  }
  const [prog] = await db
    .insert(programs)
    .values({
      planYearId: year.id,
      seq: 901,
      domain: `مجال ${demoTag}`,
      name: `برنامج ${demoTag} للعرض`,
      generalGoal: "هدف عام تجريبي للعرض",
      ownerPosition: "الوكيل",
      hijriStart: "1448/3/2",
      hijriEnd: "1449/1/5",
    })
    .returning();
  await db.insert(programMilestones).values([
    { programId: prog.id, title: "معلم تجريبي أول", weight: 40, progress: 100, status: "مكتمل", sortOrder: 0 },
    { programId: prog.id, title: "معلم تجريبي ثانٍ", weight: 35, progress: 50, status: "قيد التنفيذ", sortOrder: 1 },
    { programId: prog.id, title: "معلم تجريبي ثالث", weight: 25, progress: 0, status: "لم يبدأ", sortOrder: 2 },
  ]);
  await db.update(programs).set({ progress: 58 }).where(eq(programs.id, prog.id));

  console.log("اكتملت البذرة التجريبية — سجلات موسومة بكلمة «تجريبي».");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

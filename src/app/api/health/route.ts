import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { releaseIdentity } from "@/lib/release";

/**
 * فحص صحة التطبيق (لفحوصات صحة الحاوية والمراقبة). لا يتطلب مصادقة، ولا يكشف أسراراً —
 * يعيد فقط حالة الاتصال بقاعدة البيانات وإصدار التطبيق ووقت التشغيل.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  // v2.4.1 §8: الرقم من مصدر الإصدار الواحد لا من متغير بيئة قد ينحرف عن الشيفرة المنشورة
  const { version, commit, environment } = releaseIdentity();
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({
      status: "ok",
      db: "up",
      version,
      commit,
      environment,
      time: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ status: "degraded", db: "down", version, commit, environment }, { status: 503 });
  }
}

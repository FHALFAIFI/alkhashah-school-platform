import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * فحص صحة التطبيق (لفحوصات صحة الحاوية والمراقبة). لا يتطلب مصادقة، ولا يكشف أسراراً —
 * يعيد فقط حالة الاتصال بقاعدة البيانات وإصدار التطبيق ووقت التشغيل.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const version = process.env.APP_VERSION ?? process.env.npm_package_version ?? "unknown";
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: "ok", db: "up", version, time: new Date().toISOString() });
  } catch {
    return NextResponse.json({ status: "degraded", db: "down", version }, { status: 503 });
  }
}

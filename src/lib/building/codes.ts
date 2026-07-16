import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { rooms, assets, maintenanceIssues } from "@/db/schema";
import { getSetting } from "@/lib/settings";

export async function nextRoomCode(): Promise<string> {
  const prefix = await getSetting("rooms.code_prefix", "KHS-RM-");
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(rooms);
  return `${prefix}${String(count + 1).padStart(4, "0")}`;
}

export async function nextAssetCode(): Promise<string> {
  const prefix = await getSetting("assets.code_prefix", "KHS-AST-");
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(assets);
  return `${prefix}${String(count + 1).padStart(4, "0")}`;
}

export async function nextMaintenanceCode(): Promise<string> {
  const prefix = await getSetting("maintenance.code_prefix", "KHS-MNT-");
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(maintenanceIssues);
  return `${prefix}${String(count + 1).padStart(4, "0")}`;
}

/**
 * تحليل رمز غرفة مدخل يدوياً (بديل مسح QR على HTTP) — يتجاهل الفراغات وحالة الأحرف.
 * يعيد الغرفة أو null إذا لم يوجد رمز مطابق.
 */
export async function findRoomByCode(code: string) {
  const needle = code.trim().toLowerCase();
  if (!needle) return null;
  const [room] = await db
    .select()
    .from(rooms)
    .where(sql`lower(${rooms.code}) = ${needle}`)
    .limit(1);
  return room ?? null;
}

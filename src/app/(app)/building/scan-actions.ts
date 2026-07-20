"use server";

import { sql, eq } from "drizzle-orm";
import { db } from "@/db";
import { rooms, assets } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { isUuid } from "@/lib/validation";
import { parseScanInput } from "@/lib/building/qr-parse";

/**
 * Phase 5 — حل رمز QR/الرمز المُدخل يدوياً إلى غرفة أو أصل. قراءة فقط — لا كتابة من المسح.
 * يتعامل مع الرموز غير الصالحة/المجهولة/المؤرشفة/غير المصرّح بها برسائل عربية واضحة.
 */
export type ScanResolution =
  | { ok: true; kind: "room"; id: string; code: string; nameAr: string; canInspect: boolean; canMaintain: boolean }
  | { ok: true; kind: "asset"; id: string; code: string; nameAr: string; archived: boolean; roomId: string | null; canMaintain: boolean }
  | { ok: false; error: string };

async function findRoom(by: "id" | "code", value: string) {
  if (by === "id") {
    if (!isUuid(value)) return null;
    const [r] = await db.select().from(rooms).where(eq(rooms.id, value));
    return r ?? null;
  }
  const [r] = await db.select().from(rooms).where(sql`lower(${rooms.code}) = ${value.trim().toLowerCase()}`).limit(1);
  return r ?? null;
}

async function findAsset(code: string) {
  const [a] = await db.select().from(assets).where(sql`lower(${assets.code}) = ${code.trim().toLowerCase()}`).limit(1);
  return a ?? null;
}

export async function resolveScanAction(raw: string): Promise<ScanResolution> {
  const user = await requirePermission("building.read");
  const canInspect = user.permissions.has("inspections.write");
  const canMaintain = user.permissions.has("maintenance.write");

  const parsed = parseScanInput(raw);

  // محاولة الحل حسب التحليل، مع بديل: جرّب رمز الغرفة ثم رمز الأصل عند غياب البادئة المعروفة
  const tryRoom = async (by: "id" | "code", value: string): Promise<ScanResolution | null> => {
    const r = await findRoom(by, value);
    if (!r) return null;
    if (!r.active) return { ok: false, error: `الغرفة «${r.nameAr}» مؤرشفة — لا يمكن بدء إجراء عليها` };
    return { ok: true, kind: "room", id: r.id, code: r.code, nameAr: r.nameAr, canInspect, canMaintain };
  };
  const tryAsset = async (code: string): Promise<ScanResolution | null> => {
    const a = await findAsset(code);
    if (!a) return null;
    return {
      ok: true,
      kind: "asset",
      id: a.id,
      code: a.code,
      nameAr: a.nameAr,
      archived: !a.active,
      roomId: a.roomId,
      canMaintain,
    };
  };

  if (parsed?.kind === "room") {
    const res = await tryRoom(parsed.by, parsed.value);
    if (res) return res;
    return { ok: false, error: "لا توجد غرفة بهذا الرمز — تحقق من الملصق أو أدخله يدوياً" };
  }
  if (parsed?.kind === "asset") {
    const res = await tryAsset(parsed.value);
    if (res) return res;
    return { ok: false, error: "لا يوجد أصل بهذا الرمز — تحقق من الملصق أو أدخله يدوياً" };
  }

  // لم نتعرّف على الصيغة — جرّب رمزاً خاماً كغرفة ثم كأصل
  const value = (raw ?? "").trim();
  if (value) {
    const asRoom = await tryRoom("code", value);
    if (asRoom) return asRoom;
    const asAsset = await tryAsset(value);
    if (asAsset) return asAsset;
  }
  return { ok: false, error: "تعذّرت قراءة الرمز — أدخل رمز الغرفة (KHS-RM-…) أو الأصل (KHS-AST-…) يدوياً" };
}

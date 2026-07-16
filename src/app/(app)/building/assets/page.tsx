import { asc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { assets, rooms, floors } from "@/db/schema";
import { PageHeader, Card, Badge, Table, EmptyState } from "@/components/ui";
import { NewAssetForm, AssetConditionControl } from "./assets-ui";

export const metadata = { title: "العهدة والأصول" };
export const dynamic = "force-dynamic";

export default async function AssetsPage() {
  const user = await requirePermission("assets.read");
  const [allAssets, allRooms, allFloors] = await Promise.all([
    db.select().from(assets).where(eq(assets.active, true)).orderBy(asc(assets.code)),
    db.select().from(rooms).where(eq(rooms.active, true)).orderBy(asc(rooms.nameAr)),
    db.select().from(floors),
  ]);
  const floorName = new Map(allFloors.map((f) => [f.id, f.nameAr]));
  const roomById = new Map(allRooms.map((r) => [r.id, r]));
  const canWrite = user.permissions.has("assets.write");
  // رابط رمز QR من عنوان الطلب الفعلي — يعمل عبر Tailscale أو أي نطاق دون تثبيت اسم جهاز
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  const appUrl = host ? `${proto}://${host}` : (process.env.APP_URL ?? "http://localhost:3080");

  const importantQr = new Map<string, string>();
  for (const a of allAssets.filter((x) => x.important).slice(0, 100)) {
    importantQr.set(a.id, await QRCode.toDataURL(`${appUrl}/building/assets?رمز=${a.code}`, { width: 72, margin: 0 }));
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="العهدة والأصول"
        subtitle="تبدأ العهدة فارغة ولا يخترع النظام أصولاً — الأصول المهمة سجلات فردية برقم تسلسلي، والأثاث المتكرر بالكمية والحالة"
      />
      {canWrite && (
        <Card>
          <h2 className="mb-3 font-bold text-brand-900">إضافة أصل</h2>
          <NewAssetForm
            rooms={allRooms.map((r) => ({ id: r.id, label: `${r.nameAr} — ${floorName.get(r.floorId) ?? ""} (${r.code})` }))}
          />
        </Card>
      )}
      {allAssets.length === 0 ? (
        <EmptyState title="العهدة فارغة" hint="أضف الأصول يدوياً أو استوردها من قالب Excel عبر صفحة الاستيراد" />
      ) : (
        <Table headers={["الرمز", "الأصل", "الموقع", "النوع", "الكمية/التسلسلي", "الحالة", "رمز QR", canWrite ? "تحديث الحالة" : ""]}>
          {allAssets.map((a) => {
            const room = a.roomId ? roomById.get(a.roomId) : null;
            return (
              <tr key={a.id}>
                <td className="px-3 py-2 tabular-nums">{a.code}</td>
                <td className="px-3 py-2 font-medium">{a.nameAr}</td>
                <td className="px-3 py-2 text-xs">{room ? `${room.nameAr} — ${floorName.get(room.floorId) ?? ""}` : "—"}</td>
                <td className="px-3 py-2 text-xs">{a.important ? "مهم (فردي)" : "متكرر"}</td>
                <td className="px-3 py-2 text-xs tabular-nums">{a.important ? a.serialNumber ?? "—" : a.quantity}</td>
                <td className="px-3 py-2"><Badge value={a.condition === "ممتازة" || a.condition === "جيدة" ? "مكتمل" : "متأخر"} /> <span className="text-xs">{a.condition}</span></td>
                <td className="px-3 py-2">
                  {importantQr.has(a.id) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={importantQr.get(a.id)} alt={`رمز ${a.code}`} width={40} height={40} />
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </td>
                <td className="px-3 py-2">{canWrite && <AssetConditionControl assetId={a.id} condition={a.condition} />}</td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}

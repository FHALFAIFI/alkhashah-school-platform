import Link from "next/link";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { assets, assetHistory, rooms, floors } from "@/db/schema";
import { PageHeader, Card, Badge, Table, EmptyState } from "@/components/ui";
import {
  NewAssetForm,
  AssetConditionControl,
  ArchiveAssetControl,
  RestoreAssetControl,
  DeleteAssetControl,
} from "./assets-ui";
import { getAssetDependencies } from "@/lib/building/asset-lifecycle";
import { orFallback } from "@/lib/format";

export const metadata = { title: "العهدة والأصول" };
export const dynamic = "force-dynamic";

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ رمز?: string; عرض?: string }>;
}) {
  const user = await requirePermission("assets.read");
  const params = await searchParams;
  const codeFilter = (params["رمز"] ?? "").trim().toLowerCase();
  const showArchived = params["عرض"] === "مؤرشف";

  const [listAssets, allRooms, allFloors] = await Promise.all([
    db
      .select()
      .from(assets)
      .where(showArchived ? and(eq(assets.active, false), isNotNull(assets.archivedAt)) : eq(assets.active, true))
      .orderBy(asc(assets.code)),
    db.select().from(rooms).where(eq(rooms.active, true)).orderBy(asc(rooms.nameAr)),
    db.select().from(floors),
  ]);
  const floorName = new Map(allFloors.map((f) => [f.id, f.nameAr]));
  const roomById = new Map(allRooms.map((r) => [r.id, r]));
  const canWrite = user.permissions.has("assets.write");
  const canDelete = user.permissions.has("assets.delete");

  // رابط رمز QR من عنوان الطلب الفعلي — يعمل عبر Tailscale أو أي نطاق دون تثبيت اسم جهاز
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  const appUrl = host ? `${proto}://${host}` : (process.env.APP_URL ?? "http://localhost:3080");

  const shownAssets = codeFilter ? listAssets.filter((a) => a.code.toLowerCase() === codeFilter) : listAssets;

  const importantQr = new Map<string, string>();
  for (const a of shownAssets.filter((x) => x.important).slice(0, 100)) {
    importantQr.set(a.id, await QRCode.toDataURL(`${appUrl}/building/assets?رمز=${a.code}`, { width: 72, margin: 0 }));
  }

  // سجل الأصل (الأحداث) للأصول المعروضة + تبعيات الحذف في وضع المؤرشف
  const shownIds = shownAssets.map((a) => a.id);
  const historyByAsset = new Map<string, { event: string; detail: string | null; createdAt: Date }[]>();
  if (shownIds.length > 0) {
    const hist = await db
      .select()
      .from(assetHistory)
      .where(inArray(assetHistory.assetId, shownIds))
      .orderBy(desc(assetHistory.createdAt));
    for (const row of hist) {
      const arr = historyByAsset.get(row.assetId) ?? [];
      arr.push({ event: row.event, detail: row.detail, createdAt: row.createdAt });
      historyByAsset.set(row.assetId, arr);
    }
  }
  const depsByAsset = new Map<string, { labelAr: string; count: number }[]>();
  if (showArchived && canDelete) {
    for (const a of shownAssets) depsByAsset.set(a.id, await getAssetDependencies(a.id));
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="العهدة والأصول"
        subtitle="تبدأ العهدة فارغة ولا يخترع النظام أصولاً — الأصول المهمة سجلات فردية برقم تسلسلي، والأثاث المتكرر بالكمية والحالة"
      />

      {/* مرشّح: النشط / المؤرشف */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link
          href="/building/assets"
          className={`rounded-lg px-3 py-1.5 font-medium ${!showArchived ? "bg-brand-600 text-white" : "border border-sand-200 bg-white text-gray-600"}`}
        >
          الأصول النشطة
        </Link>
        <Link
          href="/building/assets?عرض=مؤرشف"
          className={`rounded-lg px-3 py-1.5 font-medium ${showArchived ? "bg-brand-600 text-white" : "border border-sand-200 bg-white text-gray-600"}`}
        >
          الأصول المؤرشفة
        </Link>
      </div>

      {canWrite && !showArchived && (
        <Card>
          <h2 className="mb-3 font-bold text-brand-900">إضافة أصل</h2>
          <NewAssetForm
            rooms={allRooms.map((r) => ({ id: r.id, label: `${orFallback(r.nameAr)} — ${floorName.get(r.floorId) ?? ""} (${r.code})` }))}
          />
        </Card>
      )}

      {codeFilter && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-brand-50 p-2 text-sm text-brand-900">
          <span>
            عرض الأصل بالرمز <span className="tabular-nums" dir="ltr">{params["رمز"]?.trim()}</span>
            {shownAssets.length === 0 && " — لا أصل بهذا الرمز، تحقق من الملصق"}
          </span>
          <Link href={showArchived ? "/building/assets?عرض=مؤرشف" : "/building/assets"} className="font-medium text-brand-700 underline">
            إظهار الكل
          </Link>
        </div>
      )}

      {shownAssets.length === 0 ? (
        <EmptyState
          title={showArchived ? "لا أصول مؤرشفة" : "العهدة فارغة"}
          hint={showArchived ? "الأصول المؤرشفة تظهر هنا ويمكن استعادتها" : "أضف الأصول يدوياً أو استوردها من قالب Excel عبر صفحة الاستيراد"}
        />
      ) : (
        <Table
          headers={[
            "الرمز",
            "الأصل",
            "الموقع",
            "النوع",
            "الكمية/التسلسلي",
            "الحالة",
            showArchived ? "سبب الأرشفة" : "رمز QR",
            "السجل",
            canWrite ? (showArchived ? "الإجراءات" : "تحديث الحالة / دورة الحياة") : "",
          ]}
        >
          {shownAssets.map((a) => {
            const room = a.roomId ? roomById.get(a.roomId) : null;
            const history = historyByAsset.get(a.id) ?? [];
            return (
              <tr key={a.id} id={`asset-${a.code}`}>
                <td className="px-3 py-2 tabular-nums">
                  {a.code}
                  {showArchived && <span className="ms-1 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800">مؤرشف</span>}
                </td>
                <td className="px-3 py-2 font-medium">{orFallback(a.nameAr)}</td>
                <td className="px-3 py-2 text-xs">{room ? `${orFallback(room.nameAr)} — ${floorName.get(room.floorId) ?? ""}` : "—"}</td>
                <td className="px-3 py-2 text-xs">{a.important ? "مهم (فردي)" : "متكرر"}</td>
                <td className="px-3 py-2 text-xs tabular-nums">{a.important ? a.serialNumber ?? "—" : a.quantity}</td>
                <td className="px-3 py-2">
                  <Badge value={a.condition === "ممتازة" || a.condition === "جيدة" ? "مكتمل" : "متأخر"} />{" "}
                  <span className="text-xs">{a.condition}</span>
                </td>
                <td className="px-3 py-2">
                  {showArchived ? (
                    <span className="text-xs text-gray-600">{a.archivedReason ?? "—"}</span>
                  ) : importantQr.has(a.id) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={importantQr.get(a.id)} alt={`رمز ${a.code}`} width={40} height={40} />
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {history.length === 0 ? (
                    <span className="text-xs text-gray-300">—</span>
                  ) : (
                    <details>
                      <summary className="cursor-pointer text-xs text-brand-700">{history.length} حدث</summary>
                      <ul className="mt-1 space-y-0.5 text-[11px] text-gray-500">
                        {history.slice(0, 12).map((ev, i) => (
                          <li key={i}>
                            {ev.event}
                            {ev.detail ? ` — ${ev.detail}` : ""} · {ev.createdAt.toLocaleDateString("ar-SA-u-nu-latn")}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </td>
                <td className="px-3 py-2">
                  {canWrite &&
                    (showArchived ? (
                      <div className="flex flex-col gap-2">
                        <RestoreAssetControl assetId={a.id} />
                        {canDelete && (
                          <DeleteAssetControl
                            assetId={a.id}
                            deletable={(depsByAsset.get(a.id) ?? []).length === 0}
                            deps={depsByAsset.get(a.id) ?? []}
                          />
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <AssetConditionControl assetId={a.id} condition={a.condition} />
                        <ArchiveAssetControl assetId={a.id} />
                      </div>
                    ))}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}

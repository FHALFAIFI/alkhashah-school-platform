import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { getBatchWithRows } from "@/lib/imports/framework";
import { PageHeader, Card, Badge, Table } from "@/components/ui";
import { BatchActions, RowEditor } from "./batch-ui";

export const dynamic = "force-dynamic";

const PEOPLE_FIELDS: { key: string; label: string }[] = [
  { key: "fullName", label: "الاسم" },
  { key: "category", label: "الفئة" },
  { key: "jobTitle", label: "الوظيفة" },
  { key: "cadre", label: "السلك/الكادر" },
  { key: "employmentStatus", label: "الحالة" },
  { key: "orgUnit", label: "المرحلة/الجهة" },
  { key: "jobNumber", label: "رقم الوظيفة" },
];

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("imports.read");
  const { id } = await params;
  const data = await getBatchWithRows(id);
  if (!data) notFound();
  const { batch, rows } = data;

  const counts = {
    ready: rows.filter((r) => r.status === "جاهز").length,
    review: rows.filter((r) => r.status === "يحتاج مراجعة").length,
    excluded: rows.filter((r) => r.status === "مستبعد").length,
    committed: rows.filter((r) => r.status === "منفذ").length,
  };

  const isPeople = batch.importType === "people";

  return (
    <div>
      <PageHeader
        title={`دفعة استيراد: ${batch.sourceFileName}`}
        subtitle={`${rows.length} صفاً — جاهز: ${counts.ready} · يحتاج مراجعة: ${counts.review} · مستبعد: ${counts.excluded} · منفذ: ${counts.committed}`}
        actions={<Badge value={batch.status} />}
      />

      <BatchActions
        batchId={batch.id}
        status={batch.status}
        canCommit={user.permissions.has("imports.commit") && counts.review === 0 && counts.ready > 0 && batch.status === "معاينة"}
        canRollback={user.permissions.has("imports.rollback") && batch.status === "منفذة"}
        reviewCount={counts.review}
      />

      {batch.errorLog != null && (
        <Card className="mb-4 border-red-200 bg-red-50">
          <pre className="whitespace-pre-wrap text-xs text-red-800">{JSON.stringify(batch.errorLog, null, 1)}</pre>
        </Card>
      )}

      {isPeople ? (
        <Table headers={["#", "الحالة", ...PEOPLE_FIELDS.map((f) => f.label), "التحقق", ""]}>
          {rows.map((r) => {
            const m = r.mapped as Record<string, string>;
            const v = r.validation as { errors: string[]; warnings: string[] };
            return (
              <tr key={r.id} className={r.status === "مستبعد" ? "opacity-40" : ""}>
                <td className="px-3 py-2 tabular-nums">{r.rowIndex}</td>
                <td className="px-3 py-2"><Badge value={r.status} /></td>
                {PEOPLE_FIELDS.map((f) => (
                  <td key={f.key} className="px-3 py-2">{m?.[f.key] || "—"}</td>
                ))}
                <td className="px-3 py-2 text-xs">
                  {v?.errors?.map((e, i) => <div key={i} className="text-red-600">✗ {e}</div>)}
                  {v?.warnings?.map((w, i) => <div key={i} className="text-amber-600">⚠ {w}</div>)}
                </td>
                <td className="px-3 py-2">
                  {batch.status === "معاينة" && r.status !== "منفذ" && (
                    <RowEditor
                      rowId={r.id}
                      batchId={batch.id}
                      fields={PEOPLE_FIELDS}
                      values={m}
                      status={r.status}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      ) : (
        <PlanPreview rows={rows} />
      )}
    </div>
  );
}

function PlanPreview({ rows }: { rows: { id: string; mapped: unknown; status: string; validation: unknown }[] }) {
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const t = (r.mapped as { rowType?: string })?.rowType ?? "غير معروف";
    const arr = groups.get(t) ?? [];
    arr.push(r);
    groups.set(t, arr);
  }
  const labels: Record<string, string> = {
    program: "البرامج والمبادرات",
    deliverable: "المخرجات المطلوبة",
    kpi: "مؤشرات الأداء",
    risk: "سجل المخاطر",
    budget: "بنود الميزانية",
    roadmap: "خارطة التنفيذ",
  };
  return (
    <div className="space-y-6">
      {[...groups.entries()].map(([type, groupRows]) => (
        <div key={type}>
          <h2 className="mb-2 font-bold text-brand-900">
            {labels[type] ?? type} <span className="text-sm font-normal text-gray-400">({groupRows.length})</span>
          </h2>
          <Table headers={["البيان", "الحالة", "التحقق"]}>
            {groupRows.map((r) => {
              const m = r.mapped as Record<string, unknown>;
              const v = r.validation as { errors: string[]; warnings: string[] };
              const label =
                type === "program" ? `${m.seq}. ${m.name} — ${m.domain}` :
                type === "deliverable" ? `برنامج ${m.programSeq}: ${String(m.mainOutput ?? "").slice(0, 80)}` :
                type === "kpi" ? `${m.code}: ${m.nameAr}` :
                type === "risk" ? `${m.code}: ${m.risk}` :
                type === "budget" ? `${m.item} (${m.amount ?? "—"})` :
                `برنامج ${m.programSeq}: ${(m.cells as unknown[])?.length ?? 0} فترة`;
              return (
                <tr key={r.id}>
                  <td className="px-3 py-2">{label}</td>
                  <td className="px-3 py-2"><Badge value={r.status} /></td>
                  <td className="px-3 py-2 text-xs">
                    {v?.errors?.map((e, i) => <div key={i} className="text-red-600">✗ {e}</div>)}
                    {v?.warnings?.map((w, i) => <div key={i} className="text-amber-600">⚠ {w}</div>)}
                  </td>
                </tr>
              );
            })}
          </Table>
        </div>
      ))}
    </div>
  );
}

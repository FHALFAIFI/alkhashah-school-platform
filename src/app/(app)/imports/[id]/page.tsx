import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { getBatchWithRows, type RowDecisionEntry } from "@/lib/imports/framework";
import { buildConfirmSummary } from "@/lib/imports/confirm-summary";
import { peopleBatchDependencies, type PeopleRollbackPreflight } from "@/lib/imports/people-dependencies";
import { rowValidationDisplay } from "@/lib/imports/validation-display";
import { PEOPLE_FIELDS } from "@/lib/imports/people-fields";
import { PageHeader, Card, Badge, Table, WorkflowSteps, LinkButton } from "@/components/ui";
import { BatchActions, RowEditor, RowStatusBadge } from "./batch-ui";

export const dynamic = "force-dynamic";

/** مراحل سير عمل الاستيراد — تطابق ما يعرض في صفحة الرفع */
const IMPORT_STEPS = ["رفع الملف", "المعاينة والتصحيح", "الموافقة والتنفيذ", "عرض النتيجة"];

/** يشتق فهرس المرحلة الحالية من حالة الدفعة وصفوفها */
function currentStep(status: string, counts: { ready: number; review: number; deferred: number }): number {
  if (status === "منفذة" || status === "متراجع عنها") return 3;
  // معاينة (وأي حالة أخرى): مراجعة معلقة أو صفوف مؤجلة → مرحلة التصحيح، وإلا → مرحلة الموافقة
  if (counts.review > 0 || counts.deferred > 0) return 1;
  if (counts.ready > 0) return 2;
  return 1;
}

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("imports.read");
  const { id } = await params;
  const data = await getBatchWithRows(id);
  if (!data) notFound();
  const { batch, rows } = data;

  const counts = {
    ready: rows.filter((r) => r.status === "جاهز").length,
    review: rows.filter((r) => r.status === "يحتاج مراجعة").length,
    deferred: rows.filter((r) => r.status === "مؤجل").length,
    excluded: rows.filter((r) => r.status === "مستبعد").length,
    committed: rows.filter((r) => r.status === "منفذ").length,
  };

  const isPeople = batch.importType === "people";
  const canRollback = user.permissions.has("imports.rollback") && batch.status === "منفذة";
  // تدقيق التبعيات قبل التراجع الكامل — يُحسب فقط لدفعة أشخاص منفذة (حيث يظهر زر التراجع)
  const rollbackPreflight: PeopleRollbackPreflight | null =
    isPeople && batch.status === "منفذة" ? await peopleBatchDependencies(db, batch.id) : null;
  const readyRows = rows.filter((r) => r.status === "جاهز");
  // ملخص التأكيد حسب نوع الاستيراد — دفعة الخطة لا تعرض تسميات الموظفين إطلاقاً
  const confirmSummary = buildConfirmSummary(
    batch.importType,
    readyRows.map((r) => ({ mapped: r.mapped, validation: r.validation })),
    counts.excluded,
  );

  return (
    <div>
      <PageHeader
        title={`دفعة استيراد: ${batch.sourceFileName}`}
        subtitle={`${rows.length} صفاً — جاهز: ${counts.ready} · يحتاج مراجعة: ${counts.review} · مؤجل: ${counts.deferred} · مستبعد: ${counts.excluded} · منفذ: ${counts.committed}`}
        actions={<Badge value={batch.status} />}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-sand-200 bg-white p-4">
        <WorkflowSteps steps={IMPORT_STEPS} current={currentStep(batch.status, counts)} />
        {batch.status === "متراجع عنها" && <Badge value="متراجع عنها" />}
      </div>

      {batch.status === "معاينة" && counts.review > 0 && (
        <Card className="mb-4 border-amber-300 bg-amber-50">
          <p className="font-bold text-amber-900">
            {counts.review} صفاً تحتاج مراجعة قبل التنفيذ — عدّل كل صف أو أكده كجاهز أو استبعده
          </p>
          <p className="mt-1 text-sm text-amber-800">
            استخدم أزرار «تصحيح» و«تأكيد كجاهز» و«استبعاد» في عمود الإجراءات لكل صف أدناه.
          </p>
        </Card>
      )}

      {batch.status === "منفذة" && isPeople && (
        <Card className="mb-4 border-emerald-200 bg-emerald-50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-bold text-emerald-900">تم الاستيراد</p>
              <p className="mt-1 text-sm text-emerald-800">أنشئت سجلات الموظفين من هذه الدفعة — يمكنك عرضها في سجل المعلمين والموظفين.</p>
            </div>
            <LinkButton href={`/people?دفعة=${batch.id}`}>عرض الموظفين المستوردين</LinkButton>
          </div>
        </Card>
      )}

      <BatchActions
        batchId={batch.id}
        status={batch.status}
        canCommit={user.permissions.has("imports.commit") && counts.review === 0 && counts.deferred === 0 && counts.ready > 0 && batch.status === "معاينة"}
        canRollback={canRollback}
        rollbackPreflight={rollbackPreflight}
        reviewCount={counts.review}
        deferredCount={counts.deferred}
        fileName={batch.sourceFileName}
        confirmTitle={confirmSummary.title}
        confirmItems={confirmSummary.items}
      />

      {batch.errorLog != null && (
        <Card className="mb-4 border-red-200 bg-red-50">
          <ErrorLogList log={batch.errorLog} />
        </Card>
      )}

      {isPeople ? (
        <>
          {/* الجوال: كل صف معاينة بطاقة عربية رأسية كاملة — لا تمرير أفقي إطلاقاً */}
          <div className="space-y-3 lg:hidden">
            {rows.map((r) => {
              const m = r.mapped as Record<string, string>;
              const history = (r.decisionHistory as RowDecisionEntry[] | null) ?? [];
              return (
                <div
                  key={r.id}
                  data-testid="import-row-card"
                  className={`rounded-xl border border-sand-200 bg-white p-4 ${r.status === "مستبعد" ? "opacity-60" : ""}`}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs tabular-nums text-gray-400">الصف {r.rowIndex}</span>
                    {/* D-069: الشارة تعرض الحالة المؤكدة من العميل فور القرار — لا تنتظر تحديث الصفحة */}
                    <RowStatusBadge rowId={r.id} status={r.status} />
                  </div>
                  <p className="mb-2 break-words font-bold text-brand-900">
                    {r.status === "منفذ" && r.createdEntityId ? (
                      <Link prefetch={false} href={`/people/${r.createdEntityId}`} className="text-brand-700 underline-offset-2 hover:underline">
                        {m?.fullName || "—"}
                      </Link>
                    ) : (
                      m?.fullName || "—"
                    )}
                  </p>
                  <dl className="mb-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                    {PEOPLE_FIELDS.filter((f) => f.key !== "fullName").map((f) => (
                      <div key={f.key}>
                        <dt className="text-xs text-gray-400">{f.label}</dt>
                        <dd className="break-words">{m?.[f.key] || "—"}</dd>
                      </div>
                    ))}
                  </dl>
                  <ValidationNotes status={r.status} validation={r.validation} />
                  {batch.status === "معاينة" && r.status !== "منفذ" && (
                    <div className="mt-2 border-t border-sand-100 pt-2">
                      <RowEditor
                        rowId={r.id}
                        batchId={batch.id}
                        fields={PEOPLE_FIELDS}
                        values={m}
                        status={r.status}
                        history={history}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* سطح المكتب: الجدول كما هو */}
          <div className="hidden lg:block">
            <Table headers={["#", "الحالة", ...PEOPLE_FIELDS.map((f) => f.label), "التحقق", ""]}>
              {rows.map((r) => {
                const m = r.mapped as Record<string, string>;
                const history = (r.decisionHistory as RowDecisionEntry[] | null) ?? [];
                return (
                  <tr key={r.id} className={r.status === "مستبعد" ? "opacity-40" : ""}>
                    <td className="px-3 py-2 tabular-nums">{r.rowIndex}</td>
                    {/* D-069: كالبطاقة — الحالة المؤكدة من العميل تظهر فور القرار */}
                    <td className="px-3 py-2"><RowStatusBadge rowId={r.id} status={r.status} /></td>
                    {PEOPLE_FIELDS.map((f) => (
                      <td key={f.key} className="px-3 py-2">
                        {f.key === "fullName" && r.status === "منفذ" && r.createdEntityId ? (
                          <Link prefetch={false} href={`/people/${r.createdEntityId}`} className="font-medium text-brand-700 underline-offset-2 hover:underline">
                            {m?.[f.key] || "—"}
                          </Link>
                        ) : (
                          m?.[f.key] || "—"
                        )}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-xs">
                      <ValidationNotes status={r.status} validation={r.validation} />
                    </td>
                    <td className="px-3 py-2">
                      {batch.status === "معاينة" && r.status !== "منفذ" && (
                        <RowEditor
                          rowId={r.id}
                          batchId={batch.id}
                          fields={PEOPLE_FIELDS}
                          values={m}
                          status={r.status}
                          history={history}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
          </div>
        </>
      ) : (
        <PlanPreview rows={rows} />
      )}
    </div>
  );
}

/**
 * ملاحظات التحقق حسب حالة القرار: الأخطاء دائماً، والتحذيرات نشطة فقط قبل الحسم؛
 * بعد الحسم يظهر «تمت مراجعة التصنيف» بدل تحذير التصنيف (الأصل يبقى في سجل القرارات).
 */
function ValidationNotes({ status, validation }: { status: string; validation: unknown }) {
  const v = rowValidationDisplay(status, validation as { errors?: string[]; warnings?: string[] } | null);
  if (v.errors.length === 0 && v.activeWarnings.length === 0 && v.resolvedNotes.length === 0) return null;
  return (
    <div className="text-xs">
      {v.errors.map((e, i) => <div key={`e${i}`} className="text-red-600">✗ {e}</div>)}
      {v.activeWarnings.map((w, i) => <div key={`w${i}`} className="text-amber-600">⚠ {w}</div>)}
      {v.resolvedNotes.map((n, i) => <div key={`r${i}`} className="text-emerald-700">✓ {n}</div>)}
    </div>
  );
}

/**
 * سجل الأخطاء بصيغة عربية مقروءة (رقم الصف + الرسالة) بدل JSON الخام،
 * مع تحمل الأشكال غير المعروفة دون كسر الصفحة.
 */
function ErrorLogList({ log }: { log: unknown }) {
  const entries: { rowIndex?: number; message: string }[] = [];
  const push = (item: unknown) => {
    if (typeof item === "string") {
      entries.push({ message: item });
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const rowIndex =
        typeof o.rowIndex === "number" ? o.rowIndex : typeof o.row === "number" ? o.row : undefined;
      const message =
        typeof o.message === "string" ? o.message : typeof o.error === "string" ? o.error : JSON.stringify(item);
      entries.push({ rowIndex, message });
    } else if (item != null) {
      entries.push({ message: String(item) });
    }
  };
  if (Array.isArray(log)) log.forEach(push);
  else push(log);

  if (entries.length === 0) return null;
  return (
    <div>
      <p className="mb-2 font-bold text-red-900">سجل الأخطاء</p>
      <ul className="space-y-1 text-sm text-red-800">
        {entries.map((e, i) => (
          <li key={i}>
            {e.rowIndex !== undefined && <span className="ms-1 font-medium tabular-nums">الصف {e.rowIndex}: </span>}
            {e.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** يشتق السنة الدراسية الهجرية من تواريخ البرامج (أقدم بدء / أحدث انتهاء) */
function deriveAcademicYear(programs: Record<string, unknown>[]): string {
  const years = new Set<string>();
  for (const m of programs) {
    for (const key of ["hijriStart", "hijriEnd"]) {
      const y = String(m[key] ?? "").match(/^(\d{3,4})\//)?.[1];
      if (y) years.add(y);
    }
  }
  const sorted = [...years].sort();
  if (sorted.length === 0) return "—";
  return sorted.length === 1 ? `${sorted[0]}هـ` : `${sorted[0]}/${sorted[sorted.length - 1]}هـ`;
}

function ValidationInline({ validation }: { validation: unknown }) {
  const v = validation as { errors?: string[]; warnings?: string[] } | null;
  if (!v || ((v.errors?.length ?? 0) === 0 && (v.warnings?.length ?? 0) === 0)) return null;
  return (
    <div className="mt-1 text-xs">
      {v.errors?.map((e, i) => <div key={`e${i}`} className="text-red-600">✗ {e}</div>)}
      {v.warnings?.map((w, i) => <div key={`w${i}`} className="text-amber-600">⚠ {w}</div>)}
    </div>
  );
}

/** بطاقة برنامج قابلة للفتح — تعرض الأهداف والمؤشر والمسؤول والتواريخ والمعالم والمستهدف والشواهد */
function ProgramCard({ m, status, validation }: { m: Record<string, unknown>; status: string; validation: unknown }) {
  const s = (k: string) => String(m[k] ?? "").trim();
  const field = (label: string, key: string) =>
    s(key) ? (
      <div>
        <dt className="text-xs text-gray-400">{label}</dt>
        <dd className="break-words">{s(key)}</dd>
      </div>
    ) : null;
  return (
    <details data-testid="plan-program-card" className="rounded-xl border border-sand-200 bg-white p-3">
      <summary className="flex cursor-pointer items-center justify-between gap-2">
        <span className="break-words font-medium text-brand-900">
          {s("seq")}. {s("name")}
          <span className="text-xs font-normal text-gray-400"> — {s("domain")}</span>
        </span>
        <Badge value={status} />
      </summary>
      <dl className="mt-2 space-y-2 border-t border-sand-100 pt-2 text-sm">
        {field("الهدف العام", "generalGoal")}
        {field("الهدف الخاص", "specificGoal")}
        {field("المؤشر", "kpiText") ?? field("المؤشر", "indicator")}
        {field("مسؤول التنفيذ", "ownerPosition")}
        <div className="grid grid-cols-2 gap-x-3">
          {field("تاريخ البدء", "hijriStart")}
          {field("تاريخ الانتهاء", "hijriEnd")}
        </div>
        {field("المعالم ونقاط القياس", "milestones")}
        {field("المستهدف وشرحه", "targetText") ?? field("المستهدف", "target")}
        {field("الشواهد المطلوبة", "evidenceText")}
        {field("المخرج المطلوب", "deliverableText")}
        {s("budget") && s("budget") !== "null" ? (
          <div>
            <dt className="text-xs text-gray-400">الميزانية</dt>
            <dd className="tabular-nums">{s("budget")} ريال</dd>
          </div>
        ) : null}
      </dl>
      <ValidationInline validation={validation} />
    </details>
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

  const programRows = groups.get("program") ?? [];
  const programMapped = programRows.map((r) => r.mapped as Record<string, unknown>);
  const domains = new Set(programMapped.map((m) => String(m.domain ?? "").trim()).filter(Boolean));
  const academicYear = deriveAcademicYear(programMapped);

  return (
    <div className="space-y-6">
      {/* ملخص الخطة: السنة الدراسية + عدد المجالات والبرامج + عدّاد كل مجموعة */}
      <Card className="border-brand-200 bg-brand-50">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-gray-500">السنة الدراسية</p>
            <p className="font-bold text-brand-900 tabular-nums">{academicYear}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">عدد المجالات</p>
            <p className="font-bold text-brand-900 tabular-nums">{domains.size}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">عدد البرامج</p>
            <p className="font-bold text-brand-900 tabular-nums">{programRows.length}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">إجمالي الصفوف</p>
            <p className="font-bold text-brand-900 tabular-nums">{rows.length}</p>
          </div>
        </div>
        {domains.size > 0 && (
          <p className="mt-3 text-xs text-gray-600">
            <span className="text-gray-400">المجالات: </span>
            {[...domains].join(" · ")}
          </p>
        )}
      </Card>

      {/* البرامج: بطاقات قابلة للفتح بكل التفاصيل (تعمل على الجوال بلا تمرير أفقي) */}
      {programRows.length > 0 && (
        <div>
          <h2 className="mb-2 font-bold text-brand-900">
            {labels.program} <span className="text-sm font-normal text-gray-400">({programRows.length})</span>
          </h2>
          <div className="space-y-2">
            {programRows.map((r) => (
              <ProgramCard key={r.id} m={r.mapped as Record<string, unknown>} status={r.status} validation={r.validation} />
            ))}
          </div>
        </div>
      )}

      {/* بقية المجموعات: جداول ضمن حاوية تمرير أفقي داخلية */}
      {[...groups.entries()]
        .filter(([type]) => type !== "program")
        .map(([type, groupRows]) => (
          <div key={type}>
            <h2 className="mb-2 font-bold text-brand-900">
              {labels[type] ?? type} <span className="text-sm font-normal text-gray-400">({groupRows.length})</span>
            </h2>
            <Table headers={["البيان", "الحالة", "التحقق"]}>
              {groupRows.map((r) => {
                const m = r.mapped as Record<string, unknown>;
                const v = r.validation as { errors: string[]; warnings: string[] };
                const label =
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

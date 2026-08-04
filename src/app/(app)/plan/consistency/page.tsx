import Link from "next/link";
import { asc, eq, inArray, isNull, and, sql } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { programs, people, evidenceLinks } from "@/db/schema";
import { PageHeader, Card, Badge, Table, EmptyState } from "@/components/ui";
import { BackButton } from "@/components/back-button";
import { orDash, orFallback } from "@/lib/format";
import { dualNumericCell } from "@/lib/dates";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import {
  checkProgramConsistency,
  matchesConsistencyFilter,
  CONSISTENCY_FILTERS,
  type ConsistencyFilter,
} from "@/lib/plan/consistency";
import { CorrectProgramForm, BulkCorrectPanel } from "./consistency-ui";

export const metadata = { title: "مراجعة حالات برامج الخطة" };
export const dynamic = "force-dynamic";

/**
 * مراجعة حالات برامج الخطة (v2.4.1 §5.2).
 *
 * تكشف السجلات المتناقضة وتضع القرار عند المدير: النظام لا يخمّن أي الحقلين صحيح ولا
 * يصحّح شيئاً تلقائياً. كل تصحيح إدخال صريح مع سبب، ويُحفظ في سجل التدقيق مع نسخة قبل.
 */
export default async function PlanConsistencyPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const user = await requirePermission("plan.read");
  const canWrite = user.permissions.has("plan.write");

  const sp = await searchParams;
  const filter: ConsistencyFilter =
    sp.filter && sp.filter in CONSISTENCY_FILTERS ? (sp.filter as ConsistencyFilter) : "inconsistent";

  const excluded = await getExcludedIdSets();
  const rows = await db
    .select({
      id: programs.id,
      seq: programs.seq,
      name: programs.name,
      domain: programs.domain,
      ownerPosition: programs.ownerPosition,
      ownerPersonId: programs.ownerPersonId,
      status: programs.status,
      executionStatus: programs.executionStatus,
      progress: programs.progress,
      completedAt: programs.completedAt,
      closedAt: programs.closedAt,
      completionOverride: programs.completionOverride,
    })
    .from(programs)
    .where(and(notSynthetic(programs.id, excluded.programs), isNull(programs.archivedAt)))
    .orderBy(asc(programs.seq));

  // أسماء المسؤولين حين تكون مرتبطة بسجل منسوب (الإنتاج يستعمل المسمّى النصي غالباً)
  const personIds = [...new Set(rows.map((r) => r.ownerPersonId).filter((x): x is string => !!x))];
  const persons = personIds.length
    ? await db.select({ id: people.id, name: people.fullName }).from(people).where(inArray(people.id, personIds))
    : [];
  const personName = new Map(persons.map((p) => [p.id, p.name]));

  // عدد الشواهد لكل برنامج — سياق يساعد المدير على الحكم
  const evidenceCounts = await db
    .select({ entityId: evidenceLinks.entityId, n: sql<number>`count(*)::int` })
    .from(evidenceLinks)
    .where(eq(evidenceLinks.entityType, "program"))
    .groupBy(evidenceLinks.entityId);
  const evidenceFor = new Map(evidenceCounts.map((e) => [e.entityId, e.n]));

  const enriched = rows.map((r) => ({
    ...r,
    findings: checkProgramConsistency({
      executionStatus: r.executionStatus,
      progress: r.progress,
      completedAt: r.completedAt,
      status: r.status,
      completionOverride: r.completionOverride,
    }),
    evidenceCount: evidenceFor.get(r.id) ?? 0,
  }));

  const inconsistentCount = enriched.filter((r) => r.findings.length > 0).length;
  const shown = enriched.filter((r) =>
    matchesConsistencyFilter(
      { executionStatus: r.executionStatus, progress: r.progress, completedAt: r.completedAt, status: r.status },
      filter,
    ),
  );

  return (
    <div>
      <div className="mb-3 print:hidden">
        <BackButton fallbackHref="/plan" label="عودة إلى البرامج" />
      </div>
      <PageHeader
        title="مراجعة حالات برامج الخطة"
        subtitle="سجلات تحمل حالات متناقضة — النظام يكشفها ولا يصحّحها تلقائياً؛ القرار قرارك"
        actions={<Badge value={`${inconsistentCount} سجل يحتاج مراجعة`} />}
      />

      <Card className="mb-4">
        <p className="text-xs text-gray-600">
          مثال على التناقض: برنامج حالته «مكتمل» بينما تقدمه 0٪ وبلا تاريخ اكتمال. مثل هذه السجلات
          تجعل المتابعة الأسبوعية تبدو وكأن كل البرامج منجزة. تصحيح الحالة هنا لا يغيّر اعتماد
          البرنامج ولا إقفاله — لكل منهما إجراؤه الخاص.
        </p>
      </Card>

      {/* المرشِّحات (§5.2) */}
      <div className="mb-4 flex flex-wrap gap-2 print:hidden">
        {(Object.keys(CONSISTENCY_FILTERS) as ConsistencyFilter[]).map((key) => (
          <Link
            key={key}
            href={`/plan/consistency?filter=${key}`}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              filter === key
                ? "border-brand-500 bg-brand-50 font-medium text-brand-900"
                : "border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            {CONSISTENCY_FILTERS[key]}
          </Link>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title={filter === "inconsistent" ? "لا توجد سجلات متناقضة" : "لا برامج مطابقة لهذا المرشِّح"}
          hint={
            filter === "inconsistent"
              ? "كل حالات البرامج متسقة مع تقدمها وتواريخ اكتمالها"
              : "جرّب مرشِّحاً آخر أو «كل البرامج»"
          }
        />
      ) : (
        <div className="space-y-3">
          {shown.map((p) => (
            <Card key={p.id}>
              <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/plan/${p.id}`} className="font-bold text-brand-800 hover:underline">
                    {p.seq}. {orFallback(p.name)}
                  </Link>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                    <span>المجال: {orDash(p.domain)}</span>
                    <span>
                      المسؤول:{" "}
                      {orDash(p.ownerPersonId ? personName.get(p.ownerPersonId) ?? p.ownerPosition : p.ownerPosition)}
                    </span>
                    <span>الاعتماد: {orDash(p.status)}</span>
                    <span>الشواهد: {p.evidenceCount}</span>
                    {p.closedAt && <span className="text-amber-700">مقفل نهائياً</span>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge value={`التنفيذ: ${p.executionStatus}`} />
                  <Badge value={`التقدم: ${p.progress}٪`} />
                  <Badge value={`الاكتمال: ${p.completedAt ? dualNumericCell(p.completedAt.toISOString().slice(0, 10)) : "غير موثق"}`} />
                </div>
              </div>

              {p.findings.length > 0 && (
                <ul className="mb-3 space-y-1 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                  {p.findings.map((f) => (
                    <li key={f.rule}>
                      <span className="font-medium">[{f.rule}] {f.reason}</span> — {f.review}
                    </li>
                  ))}
                </ul>
              )}

              {canWrite && (
                <CorrectProgramForm
                  programId={p.id}
                  programName={orFallback(p.name)}
                  currentStatus={p.executionStatus}
                  currentProgress={p.progress}
                  hasCompletedAt={p.completedAt !== null}
                  locked={!!p.closedAt || p.status === "مقفل"}

                />
              )}
            </Card>
          ))}
        </div>
      )}

      {/* التصحيح الجماعي — عمليتان متجانستان فقط، بمعاينة وتأكيد (§5.4) */}
      {canWrite && shown.length > 0 && (
        <div className="mt-6">
          <BulkCorrectPanel
            candidates={shown.map((p) => ({
              id: p.id,
              label: `${p.seq}. ${orFallback(p.name)} — ${p.executionStatus} / ${p.progress}٪`,
              locked: !!p.closedAt || p.status === "مقفل",
            }))}

          />
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, Table, Badge, EmptyState, LinkButton } from "@/components/ui";
import { BackButton } from "@/components/back-button";
import { EMPLOYEE_TYPES, type EmployeeType } from "@/lib/employee-type";
import { individualReportLabel } from "@/lib/performance/report-labels";
import {
  loadIndividualCandidates,
  loadIndividualCycles,
  NO_INDIVIDUAL_DATA_MESSAGE,
} from "@/lib/performance/results-service";
import { isUuid } from "@/lib/validation";
import { orDash } from "@/lib/format";

export const metadata = { title: "التقرير التفصيلي الفردي" };
export const dynamic = "force-dynamic";

/**
 * سير التقرير التفصيلي الفردي (v2.5.0 §7.3).
 *
 * ── المشكلة التي يعالجها ────────────────────────────────────────────────────
 * التقرير الفردي كان موجوداً منذ v2.4 على `/performance/employees/[personId]`، لكن الوصول
 * إليه يفترض أن يعرف المدير **معرّف الموظف** ويصل من لوحة التحليلات. فبدا التقرير غائباً.
 * هنا خطوات صريحة مرقّمة: النوع ← الموظف ← الدورة ← المعاينة ← الإصدار.
 *
 * ── وحين لا توجد بيانات ─────────────────────────────────────────────────────
 * لا يُخفى التقرير ولا يُصدَّر فارغاً: يُقال السبب المحدَّد لكل دورة (بلا جلسات، بلا
 * تقديرات، نموذج بلا معايير)، وتُعرض الرسالة التي طلبها التكليف حرفياً حين لا تصلح أي
 * دورة للإصدار.
 */
export default async function IndividualReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // بيانات أداء فردية — الصلاحيتان معاً شرط الدخول (D-013)
  const user = await requirePermission("performance.read", "performance.individual.read");
  const sp = await searchParams;
  const first = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);

  const typeParam = first("نوع");
  const selectedType = (EMPLOYEE_TYPES as readonly string[]).includes(typeParam ?? "")
    ? (typeParam as EmployeeType)
    : undefined;
  const personId = first("موظف");
  const validPerson = personId && isUuid(personId) ? personId : undefined;
  const cycleId = first("دورة");

  const candidates = await loadIndividualCandidates(selectedType);
  const selected = validPerson ? candidates.find((c) => c.personId === validPerson) : undefined;
  const cycles = selected ? await loadIndividualCycles(selected.personId) : [];
  const chosenCycle = cycleId ? cycles.find((c) => c.cycleId === cycleId) : cycles.at(-1);
  const issuable = chosenCycle !== undefined && chosenCycle.resultPercent !== null;
  const noUsableCycle = selected !== undefined && cycles.every((c) => c.resultPercent === null);

  const href = (params: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
    return `/reports/individual?${p.toString()}`;
  };

  return (
    <div className="space-y-5">
      <div className="print:hidden">
        <BackButton fallbackHref="/reports" label="عودة إلى مركز التقارير" />
      </div>
      <PageHeader
        title="التقرير التفصيلي الفردي"
        subtitle="اختر نوع الموظف ثم الموظف ثم الدورة — تُعرض المعاينة قبل الإصدار"
      />

      {/* الخطوة 1 — نوع الموظف (§7.2) */}
      <Card>
        <h2 className="mb-2 text-sm font-bold text-brand-900">١. نوع الموظف</h2>
        <div className="flex flex-wrap gap-2">
          {EMPLOYEE_TYPES.map((t) => (
            <LinkButton key={t} href={href({ نوع: t })} variant={selectedType === t ? "primary" : "secondary"}>
              {t === "معلم" ? "المعلمون" : "الموظفون الإداريون"}
            </LinkButton>
          ))}
          <LinkButton href={href({})} variant={selectedType ? "secondary" : "primary"}>الجميع</LinkButton>
        </div>
      </Card>

      {/* الخطوة 2 — الموظف */}
      <Card>
        <h2 className="mb-2 text-sm font-bold text-brand-900">٢. الموظف ({candidates.length})</h2>
        {candidates.length === 0 ? (
          <EmptyState title="لا موظفين في هذه الفئة" hint="سجل المنسوبين يُدار من صفحة «المنسوبون»" />
        ) : (
          <Table headers={["الموظف", "النوع", "عدد الدورات", ""]}>
            {candidates.map((c) => (
              <tr key={c.personId} className={c.personId === selected?.personId ? "bg-sand-50/60" : undefined}>
                <td className="px-3 py-2 text-sm font-medium">{c.name}</td>
                <td className="px-3 py-2 text-xs">{c.type}</td>
                <td className="px-3 py-2 tabular-nums">{c.cycleCount}</td>
                <td className="px-3 py-2">
                  {c.cycleCount === 0 ? (
                    <span className="text-xs text-gray-400">لا دورات أداء</span>
                  ) : (
                    <LinkButton href={href({ نوع: selectedType, موظف: c.personId })} variant="secondary">
                      {c.personId === selected?.personId ? "مختار" : "اختيار"}
                    </LinkButton>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* الخطوة 3 — الدورة */}
      {selected && (
        <Card>
          <h2 className="mb-2 text-sm font-bold text-brand-900">٣. دورة التقييم ({cycles.length})</h2>
          {cycles.length === 0 ? (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{NO_INDIVIDUAL_DATA_MESSAGE}</p>
          ) : (
            <Table headers={["الدورة", "النموذج", "المعايير المقيَّمة", "النتيجة", "الفئة", "الحالة", ""]}>
              {cycles.map((c) => (
                <tr key={c.cycleId} className={c.cycleId === chosenCycle?.cycleId ? "bg-sand-50/60" : undefined}>
                  <td className="px-3 py-2 text-sm tabular-nums">{c.yearKey}</td>
                  <td className="px-3 py-2 text-xs">{c.modelName}</td>
                  <td className="px-3 py-2 text-xs tabular-nums">{c.ratedCount} / {c.criteriaCount}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {c.resultPercent === null ? <span className="text-xs text-gray-500">{c.missingReason}</span> : `${c.resultPercent}٪`}
                  </td>
                  <td className="px-3 py-2 text-xs">{c.band}</td>
                  <td className="px-3 py-2"><Badge value={c.cycleStatus} /></td>
                  <td className="px-3 py-2">
                    <LinkButton href={href({ نوع: selectedType, موظف: selected.personId, دورة: c.cycleId })} variant="secondary">
                      {c.cycleId === chosenCycle?.cycleId ? "معروضة" : "معاينة"}
                    </LinkButton>
                  </td>
                </tr>
              ))}
            </Table>
          )}
          {noUsableCycle && cycles.length > 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{NO_INDIVIDUAL_DATA_MESSAGE}</p>
          )}
        </Card>
      )}

      {/* الخطوة 4 — المعاينة */}
      {selected && chosenCycle && (
        <Card>
          <h2 className="mb-2 text-sm font-bold text-brand-900">٤. معاينة التقرير</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <Row label="الموظف" value={selected.name} />
            <Row label="نوع الموظف" value={selected.type} />
            <Row label="المسمى الوظيفي" value={orDash(chosenCycle.jobTitle)} />
            <Row label="القسم" value={orDash(chosenCycle.department)} />
            <Row label="الدورة" value={chosenCycle.yearKey} />
            <Row label="النموذج" value={chosenCycle.modelName} />
            <Row label="عدد المعايير" value={String(chosenCycle.criteriaCount)} />
            <Row label="المعايير المقيَّمة" value={String(chosenCycle.ratedCount)} />
            <Row
              label="النتيجة النهائية"
              value={chosenCycle.resultPercent === null ? (chosenCycle.missingReason ?? "—") : `${chosenCycle.resultPercent}٪`}
            />
            <Row label="الفئة" value={chosenCycle.band} />
            <Row label="نقاط القوة" value={chosenCycle.strengths.join(" · ") || "—"} />
            <Row label="جوانب التحسين" value={chosenCycle.weaknesses.join(" · ") || "—"} />
            <Row label="التوصيات" value={chosenCycle.recommendations.join(" · ") || "—"} />
            <Row label="المعايير الضعيفة" value={chosenCycle.weakCriteria.join("، ") || "—"} />
          </dl>

          {/* الخطوة 5 — الإصدار، ولا يُصدَّر تقرير بلا نتيجة */}
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-sand-100 pt-3">
            {issuable ? (
              <>
                <LinkButton href={`/performance/employees/${selected.personId}?دورة=${chosenCycle.cycleId}`}>
                  {individualReportLabel(selected.type)} — فتح وإصدار
                </LinkButton>
                {user.permissions.has("reports.generate") && (
                  <span className="text-xs text-gray-500">
                    الإصدار الرسمي يمنح رقم وثيقة ولقطة مجمّدة من صفحة التقرير.
                  </span>
                )}
              </>
            ) : (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                {chosenCycle.missingReason ?? NO_INDIVIDUAL_DATA_MESSAGE} — لا يُصدَر تقرير رسمي بلا نتيجة.
              </p>
            )}
          </div>
        </Card>
      )}

      <p className="text-xs text-gray-500 print:hidden">
        للتقارير الجماعية والإحصائية:{" "}
        <Link href="/reports?category=performance" className="text-brand-700 hover:underline">
          تقارير الأداء الوظيفي
        </Link>
        {" · "}
        <Link href="/performance/analytics" className="text-brand-700 hover:underline">
          لوحة الأداء والتقرير الشامل
        </Link>
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-36 shrink-0 text-gray-500">{label}:</dt>
      <dd className="min-w-0 text-gray-800">{value}</dd>
    </div>
  );
}

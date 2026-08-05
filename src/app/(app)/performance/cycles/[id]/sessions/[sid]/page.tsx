import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { perfCycles, perfSessions, perfRatings, people, documents } from "@/db/schema";
import { PageHeader, Card, Badge, SubmitButton } from "@/components/ui";
import { RatingsForm, SignedReportUpload, CompleteSessionButton, ReopenSessionForm } from "./session-ui";
import { EvidencePanel } from "@/components/evidence-panel";
import { ReportActions } from "@/components/report-actions";
import { evidenceForEntity } from "@/lib/evidence";
import { generateSessionReport } from "@/lib/reports/session-report";
import { getSetting } from "@/lib/settings";
import { getVersions } from "@/lib/versioning";
import { orFallback, orDash } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SessionPage({ params }: { params: Promise<{ id: string; sid: string }> }) {
  const user = await requirePermission("performance.read", "performance.individual.read");
  const { id, sid } = await params;
  const [session] = await db.select().from(perfSessions).where(eq(perfSessions.id, sid));
  if (!session || session.cycleId !== id) notFound();
  const [cycle] = await db.select().from(perfCycles).where(eq(perfCycles.id, id));
  const [person] = await db.select().from(people).where(eq(people.id, cycle.personId));
  const ratings = await db.select().from(perfRatings).where(eq(perfRatings.sessionId, sid));
  const evidence = await evidenceForEntity("perf_session", sid);
  const versions = await getVersions("perf_session", sid);
  const reportDoc = session.reportDocId
    ? (await db.select().from(documents).where(eq(documents.id, session.reportDocId)))[0]
    : null;

  const snapshot = cycle.modelSnapshot as {
    model: { nameAr: string };
    indicators: { id: string; nameAr: string; weight: string; requiresEvidence: boolean }[];
  };
  const ratingByIndicator = new Map(ratings.map((r) => [r.indicatorId, r]));
  const evidenceByIndicator = new Map<string, number>();
  for (const e of evidence) {
    if (e.link.subKey) evidenceByIndicator.set(e.link.subKey, (evidenceByIndicator.get(e.link.subKey) ?? 0) + 1);
  }

  const editable = session.status === "مسودة" || session.status === "بانتظار التقرير الموقع";
  const canWrite = user.permissions.has("performance.write") && editable && cycle.status !== "مقفلة";
  const canApprove = user.permissions.has("performance.approve");
  const canBrand = user.permissions.has("branding.use");
  const defaultSig = await getSetting("branding.signature_default", false);
  const defaultStamp = await getSetting("branding.stamp_default", false);

  async function issueReport(formData: FormData) {
    "use server";
    const u = await requirePermission("reports.generate", "performance.individual.read");
    const withSignature = formData.get("withSignature") === "on" && u.permissions.has("branding.use");
    const withStamp = formData.get("withStamp") === "on" && u.permissions.has("branding.use");
    await generateSessionReport({ sessionId: sid, withSignature, withStamp, issuedBy: u.id });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={`جلسة ${session.sessionType} — ${person.fullName}`}
        subtitle={`${orFallback(snapshot.model.nameAr)} — ${orDash(cycle.yearKey)}${session.sessionDate ? ` — ${session.sessionDate}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge value={session.status} />
          </div>
        }
      />

      {(session.warningFlags ?? []).length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          {(session.warningFlags ?? []).map((w, i) => (
            <p key={i} className="text-sm text-amber-900">⚠ {w}</p>
          ))}
        </Card>
      )}

      {session.sessionType === "نهائي" && (
        <Card>
          <h2 className="mb-2 font-bold text-brand-900">شواهد المؤشرات (اختيارية)</h2>
          <p className="mb-3 text-xs text-gray-400">
            يمكن ربط الشواهد بالمؤشرات من لوحة الشواهد أدناه (حقل «المؤشر المرتبط»). الشواهد اختيارية ولا تمنع إقفال التقييم النهائي.
          </p>
          <ul className="space-y-1.5 text-sm">
            {snapshot.indicators.filter((i) => i.requiresEvidence).map((ind) => {
              const count = evidenceByIndicator.get(ind.id) ?? 0;
              return (
                <li key={ind.id} className="flex flex-wrap items-center gap-2">
                  {count > 0 ? (
                    <span className="text-emerald-600" aria-hidden>✓</span>
                  ) : (
                    <span className="text-gray-300" aria-hidden>—</span>
                  )}
                  <span>{orFallback(ind.nameAr)}</span>
                  <span className="text-xs tabular-nums text-gray-400">
                    {count > 0 ? `${count} شاهد` : "لا شواهد بعد"}
                  </span>
                </li>
              );
            })}
            {snapshot.indicators.every((i) => !i.requiresEvidence) && (
              <li className="text-gray-400">لا مؤشرات موسومة بالشواهد في هذا النموذج</li>
            )}
          </ul>
        </Card>
      )}

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold text-brand-900">المؤشرات والتقديرات</h2>
          <div className="text-sm text-gray-500">
            النتيجة المحسوبة: <strong className="tabular-nums">{session.sessionResult ? `${Number(session.sessionResult).toFixed(2)}٪` : "—"}</strong>
            {" · "}التغطية: <strong className="tabular-nums">{session.coverage ? `${Math.round(Number(session.coverage) * 100)}٪` : "—"}</strong>
          </div>
        </div>
        <p className="mb-3 text-xs text-gray-400">
          القاعدة: الدرجة الموزونة = (التقدير ÷ 5) × وزن المؤشر. النسب تحسب في الخادم حصراً ولا يمكن تعديلها يدوياً.
          {session.sessionType !== "نهائي" && " الجلسات غير النهائية يجوز حفظها ناقصة."}
        </p>
        <RatingsForm
          sessionId={sid}
          editable={canWrite}
          indicators={snapshot.indicators.map((ind) => ({
            id: ind.id,
            nameAr: ind.nameAr,
            weight: Number(ind.weight),
            requiresEvidence: ind.requiresEvidence,
            rating: ratingByIndicator.get(ind.id)?.rating ?? null,
            note: ratingByIndicator.get(ind.id)?.note ?? "",
            evidenceCount: evidenceByIndicator.get(ind.id) ?? 0,
          }))}
          sessionFields={{
            sessionDate: session.sessionDate ?? "",
            notes: session.notes ?? "",
            strengths: session.strengths ?? "",
            improvementAreas: session.improvementAreas ?? "",
            actionsText: session.actionsText ?? "",
            nextFollowupDate: session.nextFollowupDate ?? "",
          }}
        />
      </Card>

      <EvidencePanel
        entityType="perf_session"
        entityId={sid}
        items={evidence.map((e) => ({ id: e.item.id, title: e.item.title, kind: e.item.kind, role: e.item.role, fileId: e.item.fileId, subKey: e.link.subKey }))}
        canWrite={user.permissions.has("evidence.write") && editable}
        subKeys={snapshot.indicators.map((ind) => ({ value: ind.id, label: orFallback(ind.nameAr) }))}
        subKeyLabel="المؤشر المرتبط"
      />

      <Card>
        <h2 className="mb-3 font-bold text-brand-900">التقرير والاكتمال</h2>
        <div className="space-y-3 text-sm">
          <form action={issueReport} className="flex flex-wrap items-center gap-4">
            {canBrand && (
              <>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="withSignature" defaultChecked={defaultSig} />
                  توقيع المدير
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="withStamp" defaultChecked={defaultStamp} />
                  ختم المدرسة
                </label>
              </>
            )}
            <SubmitButton
              variant="secondary"
              confirmText={session.reportDocId ? "يوجد تقرير صادر لهذه الجلسة — إعادة الإصدار تستبدل مرجع التقرير الحالي بالجديد. هل تريد المتابعة؟" : undefined}
            >
              {session.reportDocId ? "إعادة إصدار تقرير الجلسة (PDF)" : "إصدار تقرير الجلسة (PDF)"}
            </SubmitButton>
            {reportDoc?.pdfFileId && (
              <a href={`/api/files/${reportDoc.pdfFileId}`} className="text-brand-700 underline">
                تنزيل {reportDoc.docNumber}
              </a>
            )}
          </form>
          <div className="border-t border-sand-100 pt-2">
            <p className="mb-2 text-xs font-medium text-gray-500">إجراءات التقرير</p>
            <ReportActions
              wordHref={`/api/export/perf-session-docx/${sid}`}
              excelHref={`/api/export/perf-session-xlsx/${sid}`}
              latestDoc={reportDoc ? { id: reportDoc.id, docNumber: reportDoc.docNumber, pdfFileId: reportDoc.pdfFileId } : null}
            />
          </div>
          <p className="text-xs text-gray-500">توقيع المعلم/الموظف يدوي على النسخة الورقية، ثم يرفع التقرير الموقع هنا.</p>
          {session.signedReportFileId ? (
            <p className="text-emerald-700">
              ✓ التقرير الموقع مرفوع — <a href={`/api/files/${session.signedReportFileId}`} className="underline">تنزيل</a>
            </p>
          ) : (
            <p className="text-gray-500">لم يرفع التقرير الموقع بعد (اختياري)</p>
          )}
          {editable && <SignedReportUpload sessionId={sid} />}
          <div className="flex flex-wrap items-center gap-3">
            {editable && canApprove && (
              <CompleteSessionButton
                sessionId={sid}
                isFinal={session.sessionType === "نهائي"}
                disabled={!session.reportDocId}
              />
            )}
            {(session.status === "مكتملة" || session.status === "مقفلة") && canApprove && (
              <ReopenSessionForm sessionId={sid} />
            )}
          </div>
        </div>
      </Card>

      {versions.length > 0 && (
        <Card>
          <h2 className="mb-2 font-bold text-brand-900">سجل النسخ</h2>
          <div className="space-y-1 text-sm text-gray-600">
            {versions.map((v) => (
              <div key={v.id} className="flex flex-wrap gap-2">
                <span className="tabular-nums">نسخة {v.version}</span>
                <span>{v.action === "approved" ? "اعتماد" : v.action === "reopened" ? "إعادة فتح" : "تحديث"}</span>
                {v.reason && <span className="text-gray-400">— {v.reason}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

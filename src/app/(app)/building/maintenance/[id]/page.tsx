import { notFound } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import {
  maintenanceIssues,
  maintenanceStatusHistory,
  inspectionFindings,
  rooms,
  floors,
  people,
  users,
} from "@/db/schema";
import { PageHeader, Card, Badge, Table, SubmitButton } from "@/components/ui";
import { BackButton } from "@/components/back-button";
import { revalidatePath } from "next/cache";
import { isUuid } from "@/lib/validation";
import { orDash, orFallback } from "@/lib/format";
import { dualNumericCell } from "@/lib/dates";
import { IssueWorkflowControl, IssueReportFieldsForm } from "../maintenance-ui";
import { MAINTENANCE_FIELD_UNSET } from "@/lib/building/maintenance-report";

export const metadata = { title: "بلاغ صيانة" };
export const dynamic = "force-dynamic";

/**
 * صفحة البلاغ (v2.3 §18) — المتابعة الكاملة من الاعتماد حتى الإغلاق:
 * بيانات الموقع، الجهة المستلمة وتواريخ الإرسال والزيارة (مزدوجة التقويم)،
 * نتيجة المعالجة، سجل الانتقالات الإلحاقي، والصور.
 */
export default async function MaintenanceIssuePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("maintenance.read");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [issue] = await db.select().from(maintenanceIssues).where(eq(maintenanceIssues.id, id));
  if (!issue) notFound();

  const [history, room, owner, finding] = await Promise.all([
    db
      .select()
      .from(maintenanceStatusHistory)
      .where(eq(maintenanceStatusHistory.issueId, id))
      .orderBy(asc(maintenanceStatusHistory.at)),
    issue.roomId
      ? db.select().from(rooms).where(eq(rooms.id, issue.roomId)).then((r) => r[0] ?? null)
      : Promise.resolve(null),
    issue.ownerPersonId
      ? db.select().from(people).where(eq(people.id, issue.ownerPersonId)).then((r) => r[0] ?? null)
      : Promise.resolve(null),
    issue.inspectionFindingId
      ? db.select().from(inspectionFindings).where(eq(inspectionFindings.id, issue.inspectionFindingId)).then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);
  const floor = room ? (await db.select().from(floors).where(eq(floors.id, room.floorId)))[0] : null;
  // v2.4 §14ب: هوية الفحص المصدر — تاريخه يظهر مع الملاحظة على صفحة البلاغ
  const { inspections } = await import("@/db/schema");
  const sourceInspection = finding
    ? ((await db.select().from(inspections).where(eq(inspections.id, finding.inspectionId)))[0] ?? null)
    : null;

  const actorIds = [...new Set(history.map((h) => h.actorId).filter((x): x is string => !!x))];
  const actorRows = actorIds.length
    ? await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, actorIds))
    : [];
  const actorName = new Map(actorRows.map((u) => [u.id, u.name]));

  const canWrite = user.permissions.has("maintenance.write");

  // آخر خطاب مولَّد لهذا البلاغ (إن وُجد)
  const { documents } = await import("@/db/schema");
  const letterDoc = issue.documentId
    ? (
        await db
          .select({ id: documents.id, docNumber: documents.docNumber, pdfFileId: documents.pdfFileId })
          .from(documents)
          .where(eq(documents.id, issue.documentId))
      )[0] ?? null
    : null;

  async function issueLetter() {
    "use server";
    const u = await requirePermission("reports.generate", "maintenance.read");
    const { generateMaintenanceLetter } = await import("@/lib/reports/maintenance-letter");
    try {
      await generateMaintenanceLetter({ issueId: id, issuedBy: u.id });
    } catch {
      // سباق نادر (بلاغ عاد مسودة): الصفحة تعاد وتظهر حالة المسودة وشرحها بدل حد الخطأ
    }
    revalidatePath(`/building/maintenance/${id}`);
  }

  // v2.4 §14د: اعتماد البلاغ وإصدار خطابه بخطوة واحدة — بدل إخفاء زر الخطاب بصمت للمسودة
  async function approveAndIssue() {
    "use server";
    const u = await requirePermission("maintenance.write", "reports.generate");
    const { transitionIssueAction } = await import("@/app/(app)/building/actions");
    const fd = new FormData();
    fd.set("issueId", id);
    fd.set("toStatus", "معتمد");
    const res = await transitionIssueAction(null, fd);
    if (res?.error) return; // الصفحة تعاد وحالة البلاغ توضح السبب
    const { generateMaintenanceLetter } = await import("@/lib/reports/maintenance-letter");
    try {
      await generateMaintenanceLetter({ issueId: id, issuedBy: u.id });
    } catch {
      // فشل التوليد لا يلغي الاعتماد — زر التوليد يبقى متاحاً بعد إعادة العرض
    }
    revalidatePath(`/building/maintenance/${id}`);
    revalidatePath("/building/maintenance");
    revalidatePath("/documents");
  }

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <BackButton fallbackHref="/building/maintenance" label="عودة إلى بلاغات الصيانة" />
      </div>
      <PageHeader
        title={`${issue.code} — ${orFallback(issue.title)}`}
        subtitle={issue.description ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            <Badge value={issue.priority} />
            <Badge value={issue.status} />
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-sm font-bold text-gray-600">بيانات البلاغ</h2>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-gray-500">الموقع</dt>
            <dd>
              {room ? (
                <a href={`/building/rooms/${room.id}`} className="text-brand-700 underline">
                  {orFallback(room.nameAr)} ({room.code}){floor ? ` — ${floor.nameAr}` : ""}
                </a>
              ) : (
                "—"
              )}
            </dd>
            <dt className="text-gray-500">المكلف بالإصلاح</dt>
            <dd>{owner ? orFallback(owner.fullName) : "—"}</dd>
            <dt className="text-gray-500">تاريخ التسجيل</dt>
            <dd className="tabular-nums">{dualNumericCell(issue.createdAt)}</dd>
            <dt className="text-gray-500">الاعتماد</dt>
            <dd className="tabular-nums">{issue.approvedAt ? dualNumericCell(issue.approvedAt) : "—"}</dd>
            <dt className="text-gray-500">الجهة المستلمة</dt>
            <dd>{orDash(issue.sentTo)}</dd>
            <dt className="text-gray-500">تاريخ الإرسال</dt>
            <dd className="tabular-nums">{issue.sentAt ? dualNumericCell(issue.sentAt) : "—"}</dd>
            <dt className="text-gray-500">زيارة الصيانة</dt>
            <dd className="tabular-nums">{issue.visitDate ? dualNumericCell(issue.visitDate) : "—"}</dd>
            <dt className="text-gray-500">الإجراء المتخذ</dt>
            <dd>{orDash(issue.actionTaken)}</dd>
            <dt className="text-gray-500">ملاحظة الإصلاح</dt>
            <dd>{orDash(issue.repairNote)}</dd>
            <dt className="text-gray-500">النتيجة</dt>
            <dd>{issue.resolution ? <Badge value={issue.resolution} /> : "—"}</dd>
            {issue.resolution === "لم يتم الإصلاح" && (
              <>
                <dt className="text-gray-500">سبب الإغلاق</dt>
                <dd>{orDash(issue.closureReason)}</dd>
                <dt className="text-gray-500">توصية المتابعة</dt>
                <dd>{orDash(issue.followupRecommendation)}</dd>
                <dt className="text-gray-500">يلزم تصعيد؟</dt>
                <dd>{issue.escalationNeeded === null ? "—" : issue.escalationNeeded ? "نعم" : "لا"}</dd>
              </>
            )}
            <dt className="text-gray-500">الإغلاق</dt>
            <dd className="tabular-nums">{issue.closedAt ? dualNumericCell(issue.closedAt) : "—"}</dd>
            {/* v2.4.1 §1.2: حقول تقرير الصيانة الرسمي ظاهرة في البطاقة كما تظهر في التقرير */}
            <dt className="text-gray-500">تصنيف الصيانة</dt>
            <dd>{issue.category ?? MAINTENANCE_FIELD_UNSET}</dd>
            <dt className="text-gray-500">أثر السلامة</dt>
            <dd>{issue.safetyImpact ?? MAINTENANCE_FIELD_UNSET}</dd>
            <dt className="text-gray-500">الأثر التشغيلي</dt>
            <dd>{issue.operationalImpact ?? MAINTENANCE_FIELD_UNSET}</dd>
            <dt className="text-gray-500">الإجراء المطلوب</dt>
            <dd>{issue.requestedAction ?? MAINTENANCE_FIELD_UNSET}</dd>
          </dl>
          {canWrite && (
            <details className="mt-3 border-t border-sand-100 pt-3 print:hidden">
              <summary className="cursor-pointer text-xs font-bold text-brand-800">تعديل بيانات تقرير الصيانة</summary>
              <div className="mt-2">
                <IssueReportFieldsForm
                  issueId={issue.id}
                  category={issue.category}
                  safetyImpact={issue.safetyImpact}
                  operationalImpact={issue.operationalImpact}
                  requestedAction={issue.requestedAction}
                />
              </div>
            </details>
          )}
          {finding && (
            <div className="mt-2 rounded bg-sand-50 p-2 text-xs text-gray-600">
              {/* v2.4 §14ب: هوية مصدر الفحص كاملة — البند وخطورته وتاريخ الفحص وحالة الملاحظة */}
              <span className="font-medium">مصدر البلاغ — ملاحظة فحص:</span> «{finding.label}»
              <span className="mx-1">·</span>الخطورة: <Badge value={finding.severity} />
              {finding.critical && <span className="ms-1 text-red-700">(حرج)</span>}
              <span className="mx-1">·</span>حالة الملاحظة: <Badge value={finding.status} />
              {sourceInspection?.inspectionDate && (
                <>
                  <span className="mx-1">·</span>فحص بتاريخ{" "}
                  <span className="tabular-nums">{dualNumericCell(sourceInspection.inspectionDate)}</span>
                </>
              )}
              <span className="mx-1">·</span>
              <a href={`/building/rooms/${finding.roomId}#findings`} className="text-brand-700 underline">
                فتح الغرفة والملاحظات
              </a>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-2 text-sm font-bold text-gray-600">الإجراء التالي</h2>
          {canWrite ? (
            <IssueWorkflowControl issueId={issue.id} status={issue.status} resolution={issue.resolution} />
          ) : (
            <p className="text-sm text-gray-400">المتابعة لصاحب صلاحية الصيانة</p>
          )}
          {/* v2.4 §14د: المسودة تشرح لماذا الخطاب غير متاح وتعرض الاعتماد والإصدار بخطوة واحدة */}
          {issue.status === "مسودة" && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm text-amber-900">
                خطاب البلاغ الرسمي غير متاح الآن لأن البلاغ ما زال <strong>مسودة</strong> — يُعتمد
                البلاغ أولاً ثم يصدر الخطاب برقم وثيقة ورمز تحقق.
              </p>
              {user.permissions.has("maintenance.write") && user.permissions.has("reports.generate") && (
                <form action={approveAndIssue} className="mt-2">
                  <SubmitButton>اعتماد البلاغ وإصدار التقرير</SubmitButton>
                </form>
              )}
            </div>
          )}
          {/* خطاب البلاغ الرسمي (v2.3 §18): يُولَّد بعد الاعتماد ويُرسل للجهة المسؤولة */}
          {user.permissions.has("reports.generate") && issue.status !== "مسودة" && (
            <form action={issueLetter} className="mt-3 border-t border-sand-100 pt-3">
              <SubmitButton variant="secondary">توليد خطاب البلاغ الرسمي (PDF)</SubmitButton>
              <p className="mt-1 text-xs text-gray-400">
                خطاب برقم وثيقة ورمز تحقق ولقطة مجمّدة — يتضمن الموقع والوصف ومصدر الفحص والمبلِّغ
                واعتماد المدير والصور وقسمي المتابعة والنتيجة النهائية.
              </p>
            </form>
          )}
          {letterDoc && (
            <p className="mt-2 text-xs">
              آخر خطاب مولَّد: <span className="tabular-nums">{letterDoc.docNumber}</span>
              {letterDoc.pdfFileId && (
                <>
                  {" — "}
                  <a href={`/api/files/${letterDoc.pdfFileId}`} className="text-brand-700 underline">
                    تنزيل PDF
                  </a>
                  {" — "}
                  <a
                    href={`/api/files/${letterDoc.pdfFileId}`}
                    target="_blank"
                    rel="noopener"
                    className="text-brand-700 underline"
                  >
                    طباعة تقرير الصيانة
                  </a>
                </>
              )}
            </p>
          )}
          {(issue.photos ?? []).length > 0 && (
            <div className="mt-3">
              <h3 className="mb-1 text-xs font-bold text-gray-500">الصور</h3>
              <div className="flex flex-wrap gap-2">
                {(issue.photos ?? []).map((p, idx) => (
                  <a key={p} href={`/api/files/${p}`} className="text-xs text-brand-700 underline">
                    صورة {idx + 1}
                  </a>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-2 text-sm font-bold text-gray-600">سجل الانتقالات</h2>
        {history.length === 0 ? (
          <p className="text-sm text-gray-400">لا انتقالات مسجلة</p>
        ) : (
          <Table headers={["من", "إلى", "بواسطة", "متى", "ملاحظة"]}>
            {history.map((h) => (
              <tr key={h.id}>
                <td className="px-3 py-2 text-xs">{h.fromStatus ?? "—"}</td>
                <td className="px-3 py-2"><Badge value={h.toStatus} /></td>
                <td className="px-3 py-2 text-xs">{h.actorId ? actorName.get(h.actorId) ?? "—" : "النظام"}</td>
                <td className="px-3 py-2 text-xs tabular-nums">{dualNumericCell(h.at)}</td>
                <td className="px-3 py-2 text-xs">{h.note ?? "—"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

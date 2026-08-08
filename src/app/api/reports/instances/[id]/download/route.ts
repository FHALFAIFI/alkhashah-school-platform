import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { isUuid } from "@/lib/validation";
import { getInstance } from "@/lib/reports/instances/service";
import { readSnapshot } from "@/lib/reports/instances/options";
import {
  buildOutputBuffer,
  readOutput,
  readSignedCopy,
  outputFileName,
  isOutputFormat,
} from "@/lib/reports/instances/outputs";
import { buildSnapshot, SnapshotPermissionError } from "@/lib/reports/instances/snapshot";
import { INSTANCE_DRAFT } from "@/lib/reports/instances/types";

/**
 * تنزيل مخرجات التقرير المحفوظ (v2.6 §B/§G).
 *
 * القاعدة (D-060): المسودة تُبنى لحظتها بختم «مسودة» ولا تُحفظ؛ التقرير المعتمد يُخدم
 * من مخرجاته **المحفوظة** — وإن غاب المخرج المخزَّن (لم تكتمل المهمة بعد) بُني من اللقطة
 * المجمّدة نفسها بثاً لا حفظاً، فالمحتوى واحد حتماً. ZIP والنسخة الموقّعة محفوظتان فقط.
 *
 * لا رسالة نظام داخلية تصل إلى المتصفّح (§H) — الأخطاء عربية عامة.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
  if (!user.permissions.has("reports.read") || !user.permissions.has("reports.generate")) {
    return NextResponse.json({ error: "لا تملك صلاحية تصدير التقارير" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "التقرير غير موجود" }, { status: 404 });
  // getInstance يعيد null للحسّاس بلا صلاحيته الفردية — لا يُكشف وجوده (D-013)
  const row = await getInstance(id, user);
  if (!row) return NextResponse.json({ error: "التقرير غير موجود" }, { status: 404 });

  const format = request.nextUrl.searchParams.get("format") ?? "pdf";
  const noStore = { "Cache-Control": "no-store" } as const;

  const contentTypes: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    zip: "application/zip",
  };

  const disposition = (fileName: string, fallbackExt: string) =>
    `attachment; filename="report.${fallbackExt}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;

  const logDownload = (fmt: string) =>
    audit({
      actorId: user.id,
      action: "report_instance.downloaded",
      entityType: "report_instance",
      entityId: row.id,
      summary: `تنزيل ${fmt} للتقرير «${row.title}»${row.reportNumber ? ` (${row.reportNumber})` : " (مسودة)"}`,
    });

  // النسخة الموقّعة — تقرير معتمد فقط، وتتطلب أن تكون مرفوعة
  if (format === "signed") {
    const signed = await readSignedCopy(row);
    if (!signed) return NextResponse.json({ error: "لا نسخة موقّعة محفوظة" }, { status: 404 });
    await logDownload("النسخة الموقّعة");
    return new NextResponse(new Uint8Array(signed.data), {
      headers: {
        "Content-Type": signed.file.mime,
        "Content-Disposition": disposition(signed.file.originalName, "pdf"),
        ...noStore,
      },
    });
  }

  if (format === "zip") {
    if (row.status === INSTANCE_DRAFT) {
      return NextResponse.json({ error: "حزمة ZIP للتقرير المعتمد وحده" }, { status: 400 });
    }
    const stored = await readOutput(row.id, "zip");
    if (!stored) return NextResponse.json({ error: "لم تُجمَّع الحزمة بعد — ولّد المخرجات أولاً" }, { status: 404 });
    await logDownload("ZIP");
    return new NextResponse(new Uint8Array(stored.data), {
      headers: {
        "Content-Type": contentTypes.zip,
        "Content-Disposition": disposition(stored.file.originalName, "zip"),
        ...noStore,
      },
    });
  }

  if (!isOutputFormat(format)) return NextResponse.json({ error: "صيغة غير معروفة" }, { status: 400 });

  // المعتمد: المخرج المحفوظ أولاً
  if (row.status !== INSTANCE_DRAFT) {
    const stored = await readOutput(row.id, format);
    if (stored) {
      await logDownload(format.toUpperCase());
      return new NextResponse(new Uint8Array(stored.data), {
        headers: {
          "Content-Type": contentTypes[format],
          "Content-Disposition": disposition(stored.file.originalName, format),
          ...noStore,
        },
      });
    }
  }

  // مسودة، أو معتمد لم تكتمل مهمته بعد: بناء من المصدر نفسه بثاً لا حفظاً
  try {
    const doc =
      row.status === INSTANCE_DRAFT
        ? await buildSnapshot({
            instanceId: row.id,
            typeKey: row.typeKey,
            title: row.title,
            storedFilters: row.filters,
            storedOptions: row.options,
            periodFrom: row.periodFrom,
            periodTo: row.periodTo,
            viewer: user,
          })
        : readSnapshot(row.snapshot);
    if (!doc) return NextResponse.json({ error: "تعذّر قراءة التقرير" }, { status: 500 });
    const buffer = await buildOutputBuffer(doc, format, { reportNumber: row.reportNumber });
    await logDownload(`${format.toUpperCase()}${row.status === INSTANCE_DRAFT ? " (مسودة)" : ""}`);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentTypes[format],
        "Content-Disposition": disposition(outputFileName(doc, format), format),
        ...noStore,
      },
    });
  } catch (e) {
    if (e instanceof SnapshotPermissionError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "تعذّر توليد التقرير" }, { status: 500 });
  }
}

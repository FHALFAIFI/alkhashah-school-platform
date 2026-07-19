import "server-only";
import { and, desc, eq, gte, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { feedback, users, storedFiles, permissions, roles, rolePermissions } from "@/db/schema";
import { audit } from "@/lib/audit";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_SEVERITIES,
  FEEDBACK_STATUSES,
  FEEDBACK_MODULES,
  FEEDBACK_LIMITS,
  deviceClassFromViewport,
  normalizeViewport,
  sanitizeFeedbackText,
  isSafeInternalPath,
  statusRequiresNote,
  type FeedbackStatus,
} from "./constants";

/** خطأ تحقق عربي — يُعرض للمستخدم كما هو */
export class FeedbackError extends Error {}

/** الأذونات الجديدة لقناة الملاحظات */
const FEEDBACK_PERMISSIONS = [
  { key: "feedback.create", nameAr: "إرسال ملاحظات التشغيل", module: "feedback" },
  { key: "feedback.manage", nameAr: "إدارة ومعالجة ملاحظات التشغيل", module: "feedback" },
];

/**
 * زرع أذونات الملاحظات ومنحها للأدوار الإدارية — فعل إضافي غير متلف وقابل للتكرار.
 * يُشغَّل على قاعدة الاختبار وقاعدة التشغيل بعد تطبيق الهجرة (لا يمسّ أي بيان قائم).
 */
export async function seedFeedbackRbac(): Promise<void> {
  for (const p of FEEDBACK_PERMISSIONS) {
    await db.insert(permissions).values(p).onConflictDoNothing({ target: permissions.key });
  }
  const grantTo = ["principal", "sysadmin"]; // المدير ومسؤول النظام أدوار إدارية مخوَّلة
  const permRows = await db.select().from(permissions);
  const permId = new Map(permRows.map((r) => [r.key, r.id]));
  for (const roleKey of grantTo) {
    const [role] = await db.select().from(roles).where(eq(roles.key, roleKey));
    if (!role) continue;
    for (const p of FEEDBACK_PERMISSIONS) {
      const pid = permId.get(p.key);
      if (!pid) continue;
      await db
        .insert(rolePermissions)
        .values({ roleId: role.id, permissionId: pid })
        .onConflictDoNothing();
    }
  }
}

export type CreateFeedbackInput = {
  actorId: string;
  pagePath: string;
  module: string;
  category: string;
  severity: string;
  title: string;
  attempted?: string | null;
  happened?: string | null;
  expected?: string | null;
  blocked: boolean;
  attachmentFileId?: string | null;
  viewport?: string | null;
  /** يُشتق في الخادم من ترويسة الطلب — ليس من العميل */
  browser?: string | null;
  /** يُلتقط في الخادم */
  appVersion?: string | null;
  ip?: string | null;
};

/** ينشئ ملاحظة تشغيل — يتحقق ويُنقّي كل الحقول، ويُرجع الرقم المرجعي المولَّد */
export async function createFeedback(input: CreateFeedbackInput): Promise<{ id: string; ref: string }> {
  if (!isSafeInternalPath(input.pagePath)) {
    throw new FeedbackError("مسار الصفحة غير صالح");
  }
  if (!FEEDBACK_CATEGORIES.includes(input.category as (typeof FEEDBACK_CATEGORIES)[number])) {
    throw new FeedbackError("فئة غير معروفة");
  }
  if (!FEEDBACK_SEVERITIES.includes(input.severity as (typeof FEEDBACK_SEVERITIES)[number])) {
    throw new FeedbackError("درجة أهمية غير معروفة");
  }
  const resolvedModule = FEEDBACK_MODULES.includes(input.module as (typeof FEEDBACK_MODULES)[number])
    ? input.module
    : "أخرى";
  const title = sanitizeFeedbackText(input.title, FEEDBACK_LIMITS.title);
  if (!title) throw new FeedbackError("العنوان المختصر مطلوب");

  const viewport = normalizeViewport(input.viewport);
  const width = viewport ? Number(viewport.split("×")[0]) : 0;
  const deviceClass = deviceClassFromViewport(width);

  const [row] = await db
    .insert(feedback)
    .values({
      createdBy: input.actorId,
      pagePath: input.pagePath,
      module: resolvedModule,
      category: input.category,
      severity: input.severity,
      title,
      attempted: sanitizeFeedbackText(input.attempted, FEEDBACK_LIMITS.attempted) || null,
      happened: sanitizeFeedbackText(input.happened, FEEDBACK_LIMITS.happened) || null,
      expected: sanitizeFeedbackText(input.expected, FEEDBACK_LIMITS.expected) || null,
      blocked: input.blocked,
      attachmentFileId: input.attachmentFileId ?? null,
      viewport: viewport || null,
      deviceClass,
      browser: input.browser ?? null,
      appVersion: input.appVersion ?? null,
      status: "جديدة",
    })
    .returning({ id: feedback.id, ref: feedback.ref });

  await audit({
    actorId: input.actorId,
    action: "feedback.created",
    entityType: "feedback",
    entityId: row.id,
    summary: `ملاحظة جديدة ${row.ref}: ${title}`,
    detail: { ref: row.ref, module: resolvedModule, category: input.category, severity: input.severity, blocked: input.blocked, pagePath: input.pagePath },
    ip: input.ip ?? undefined,
  });

  return row;
}

export type FeedbackFilters = {
  module?: string;
  category?: string;
  severity?: string;
  status?: string;
  from?: Date;
  to?: Date;
  /** all | active | archived — الافتراضي active (غير المؤرشفة) */
  archived?: "all" | "active" | "archived";
};

export type FeedbackListRow = {
  id: string;
  ref: string;
  title: string;
  module: string;
  category: string;
  severity: string;
  status: string;
  blocked: boolean;
  pagePath: string;
  createdAt: Date;
  archivedAt: Date | null;
  createdByName: string | null;
};

/** يسرد الملاحظات مع المرشّحات — يستبعد المؤرشفة افتراضياً */
export async function listFeedback(filters: FeedbackFilters = {}): Promise<FeedbackListRow[]> {
  const conds = [];
  if (filters.module) conds.push(eq(feedback.module, filters.module));
  if (filters.category) conds.push(eq(feedback.category, filters.category));
  if (filters.severity) conds.push(eq(feedback.severity, filters.severity));
  if (filters.status) conds.push(eq(feedback.status, filters.status));
  if (filters.from) conds.push(gte(feedback.createdAt, filters.from));
  if (filters.to) conds.push(lte(feedback.createdAt, filters.to));
  const arch = filters.archived ?? "active";
  if (arch === "active") conds.push(isNull(feedback.archivedAt));
  else if (arch === "archived") conds.push(isNotNull(feedback.archivedAt));

  return db
    .select({
      id: feedback.id,
      ref: feedback.ref,
      title: feedback.title,
      module: feedback.module,
      category: feedback.category,
      severity: feedback.severity,
      status: feedback.status,
      blocked: feedback.blocked,
      pagePath: feedback.pagePath,
      createdAt: feedback.createdAt,
      archivedAt: feedback.archivedAt,
      createdByName: users.displayName,
    })
    .from(feedback)
    .leftJoin(users, eq(feedback.createdBy, users.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(feedback.createdAt));
}

/** تفاصيل ملاحظة واحدة مع اسم المُرسِل وبيانات المرفق */
export async function getFeedbackById(id: string) {
  const [row] = await db
    .select({
      f: feedback,
      createdByName: users.displayName,
      attachmentName: storedFiles.originalName,
      attachmentMime: storedFiles.mime,
      attachmentSize: storedFiles.size,
    })
    .from(feedback)
    .leftJoin(users, eq(feedback.createdBy, users.id))
    .leftJoin(storedFiles, eq(feedback.attachmentFileId, storedFiles.id))
    .where(eq(feedback.id, id));
  return row ?? null;
}

export type UpdateStatusInput = {
  id: string;
  status: string;
  note?: string | null;
  actorId: string;
  ip?: string | null;
};

/**
 * يحدّث حالة الملاحظة ويسجّل الاستجابة — «تم الحل» و«لن تُنفذ» تتطلبان توثيق سبب/ملاحظة،
 * وتضبطان ملاحظة الحل وتاريخه. الملاحظة العامة تُخزَّن كملاحظة مراجعة داخلية.
 */
export async function updateFeedbackStatus(input: UpdateStatusInput): Promise<void> {
  if (!FEEDBACK_STATUSES.includes(input.status as FeedbackStatus)) {
    throw new FeedbackError("حالة غير معروفة");
  }
  const [current] = await db.select().from(feedback).where(eq(feedback.id, input.id));
  if (!current) throw new FeedbackError("الملاحظة غير موجودة");
  if (current.archivedAt) throw new FeedbackError("لا يمكن تعديل ملاحظة مؤرشفة");

  const note = sanitizeFeedbackText(input.note, FEEDBACK_LIMITS.note);
  if (statusRequiresNote(input.status) && !note) {
    throw new FeedbackError(
      input.status === "لن تُنفذ"
        ? "يجب توثيق سبب عدم التنفيذ"
        : "يجب توثيق ملاحظة الحل",
    );
  }

  const patch: Partial<typeof feedback.$inferInsert> = {
    status: input.status,
    updatedAt: new Date(),
  };
  if (note) patch.reviewNote = note;
  if (input.status === "تم الحل" || input.status === "لن تُنفذ") {
    patch.resolutionNote = note;
    patch.resolvedAt = new Date();
  }

  await db.update(feedback).set(patch).where(eq(feedback.id, input.id));

  await audit({
    actorId: input.actorId,
    action: "feedback.status_changed",
    entityType: "feedback",
    entityId: input.id,
    summary: `تغيير حالة ${current.ref}: ${current.status} ← ${input.status}`,
    detail: { ref: current.ref, from: current.status, to: input.status, note: note || null },
    ip: input.ip ?? undefined,
  });
}

export type ArchiveInput = {
  id: string;
  reason: string;
  actorId: string;
  ip?: string | null;
};

/** يؤرشف ملاحظة بسبب موثق — لا حذف نهائي مطلقاً؛ تبقى قابلة للاسترجاع */
export async function archiveFeedback(input: ArchiveInput): Promise<void> {
  const reason = sanitizeFeedbackText(input.reason, FEEDBACK_LIMITS.reason);
  if (!reason) throw new FeedbackError("سبب الأرشفة مطلوب");
  const [current] = await db.select().from(feedback).where(eq(feedback.id, input.id));
  if (!current) throw new FeedbackError("الملاحظة غير موجودة");
  if (current.archivedAt) throw new FeedbackError("الملاحظة مؤرشفة بالفعل");

  await db
    .update(feedback)
    .set({ archivedAt: new Date(), archiveReason: reason, updatedAt: new Date() })
    .where(eq(feedback.id, input.id));

  await audit({
    actorId: input.actorId,
    action: "feedback.archived",
    entityType: "feedback",
    entityId: input.id,
    summary: `أرشفة ملاحظة ${current.ref}`,
    detail: { ref: current.ref, reason },
    ip: input.ip ?? undefined,
  });
}

/** يعيد إظهار ملاحظة مؤرشفة (استرجاع) — مع تدقيق */
export async function unarchiveFeedback(input: { id: string; actorId: string; ip?: string | null }): Promise<void> {
  const [current] = await db.select().from(feedback).where(eq(feedback.id, input.id));
  if (!current) throw new FeedbackError("الملاحظة غير موجودة");
  if (!current.archivedAt) return;
  await db
    .update(feedback)
    .set({ archivedAt: null, archiveReason: null, updatedAt: new Date() })
    .where(eq(feedback.id, input.id));
  await audit({
    actorId: input.actorId,
    action: "feedback.unarchived",
    entityType: "feedback",
    entityId: input.id,
    summary: `استرجاع ملاحظة ${current.ref}`,
    detail: { ref: current.ref },
    ip: input.ip ?? undefined,
  });
}

/** عدّادات موجزة لمركز التشغيل (غير المؤرشفة) */
export async function feedbackSummaryCounts(): Promise<{ total: number; open: number; resolved: number; blocked: number }> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where ${feedback.status} not in ('تم الحل','لن تُنفذ'))::int`,
      resolved: sql<number>`count(*) filter (where ${feedback.status} = 'تم الحل')::int`,
      blocked: sql<number>`count(*) filter (where ${feedback.blocked} = true and ${feedback.status} not in ('تم الحل','لن تُنفذ'))::int`,
    })
    .from(feedback)
    .where(isNull(feedback.archivedAt));
  return row ?? { total: 0, open: 0, resolved: 0, blocked: 0 };
}

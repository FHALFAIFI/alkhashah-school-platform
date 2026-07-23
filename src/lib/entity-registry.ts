import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  programs,
  programDeliverables,
  programKpis,
  planBudgetItems,
  meetings,
  committees,
  perfSessions,
  rooms,
  assets,
  people,
  actionTasks,
} from "@/db/schema";

/**
 * سجل الكيانات القابلة للربط بالشواهد — مصدر واحد للحقيقة.
 *
 * المبدأ: «إدخال المعلومة مرة واحدة ثم إعادة استخدامها». الشاهد الواحد يُرفع مرة واحدة
 * ويُربط بأي عدد من السجلات عبر `evidence_links`. هذا السجل يحدد ما الذي يجوز الربط به،
 * وكيف يُسمّى بالعربية، وأين يُفتح، وهل السجل المرتبط «مقفل» (معتمد/مكتمل) — وتُشتق منه
 * واجهة الربط وحارس الحذف معاً بدل تكرار الشروط في كل وحدة.
 *
 * إضافة نوع جديد = مُدخل واحد هنا.
 */

export type LinkableEntityKey =
  | "program"
  | "deliverable"
  | "kpi"
  | "budget_item"
  | "committee"
  | "meeting"
  | "perf_session"
  | "perf_rating"
  | "room"
  | "asset"
  | "person"
  | "task";

export type EntityRef = {
  id: string;
  labelAr: string;
  locked: boolean;
  /** مسار مباشر للسجل حين يحتاج بناؤه بيانات إضافية (مثل الاجتماع داخل لجنته) */
  href?: string;
};

type EntityDef = {
  key: LinkableEntityKey;
  /** المسمى العربي المفرد — يظهر في واجهة الربط ورسائل الحذف */
  labelAr: string;
  /** المسمى العربي للمجموعة */
  pluralAr: string;
  /** صلاحية القراءة المطلوبة لعرض/اختيار سجلات هذا النوع */
  permission: string;
  /** مسار فتح السجل في الواجهة */
  route: (id: string) => string;
  /** يقرأ السجلات المطلوبة ويحدد المقفل منها. أي معرّف غير موجود لا يُعاد. */
  resolve: (ids: string[]) => Promise<EntityRef[]>;
};

/**
 * الحالات التي تعني أن السجل اعتُمد أو أُقفل — تعديله أو حذف شواهده يمس سجلاً تاريخياً.
 * تُستعمل موحدةً لأن الوحدات تستخدم مفردات عربية متقاربة.
 */
const LOCKED_STATES = new Set(["معتمد", "معتمدة", "مقفل", "مقفلة", "مكتمل", "مكتملة", "منفذة", "مؤرشف", "مؤرشفة"]);

export function isLockedState(status: string | null | undefined): boolean {
  return !!status && LOCKED_STATES.has(status);
}

const DEFS: Record<LinkableEntityKey, EntityDef> = {
  program: {
    key: "program",
    labelAr: "برنامج الخطة التشغيلية",
    pluralAr: "برامج الخطة التشغيلية",
    permission: "plan.read",
    route: (id) => `/plan/${id}`,
    resolve: async (ids) => {
      const rows = await db
        .select({ id: programs.id, name: programs.name, status: programs.status })
        .from(programs)
        .where(inArray(programs.id, ids));
      return rows.map((r) => ({ id: r.id, labelAr: r.name, locked: isLockedState(r.status) }));
    },
  },
  deliverable: {
    key: "deliverable",
    labelAr: "مخرج ومتطلب",
    pluralAr: "المخرجات والمتطلبات",
    permission: "plan.read",
    route: (id) => `/plan?مخرج=${id}`,
    resolve: async (ids) => {
      const rows = await db
        .select({
          id: programDeliverables.id,
          name: programDeliverables.mainOutput,
          decision: programDeliverables.packageDecision,
        })
        .from(programDeliverables)
        .where(inArray(programDeliverables.id, ids));
      return rows.map((r) => ({
        id: r.id,
        labelAr: r.name ?? "مخرج",
        locked: isLockedState(r.decision),
      }));
    },
  },
  kpi: {
    key: "kpi",
    labelAr: "مؤشر أداء",
    pluralAr: "مؤشرات الأداء",
    permission: "plan.read",
    route: (id) => `/plan/kpis?مؤشر=${id}`,
    resolve: async (ids) => {
      const rows = await db
        .select({ id: programKpis.id, name: programKpis.nameAr, code: programKpis.code })
        .from(programKpis)
        .where(inArray(programKpis.id, ids));
      // المؤشرات لا تحمل حالة اعتماد مستقلة — تتبع سنة الخطة، ولا تُقفل بذاتها.
      return rows.map((r) => ({ id: r.id, labelAr: `${r.code} — ${r.name}`, locked: false }));
    },
  },
  budget_item: {
    key: "budget_item",
    labelAr: "بند ميزانية",
    pluralAr: "بنود الميزانية",
    permission: "plan.read",
    route: (id) => `/plan?ميزانية=${id}`,
    resolve: async (ids) => {
      const rows = await db
        .select({ id: planBudgetItems.id, name: planBudgetItems.item })
        .from(planBudgetItems)
        .where(inArray(planBudgetItems.id, ids));
      return rows.map((r) => ({ id: r.id, labelAr: r.name, locked: false }));
    },
  },
  committee: {
    key: "committee",
    labelAr: "لجنة أو مجلس",
    pluralAr: "اللجان والمجالس",
    permission: "committees.read",
    route: (id) => `/committees/${id}`,
    resolve: async (ids) => {
      const rows = await db
        .select({ id: committees.id, name: committees.nameAr, status: committees.status })
        .from(committees)
        .where(inArray(committees.id, ids));
      return rows.map((r) => ({ id: r.id, labelAr: r.name, locked: isLockedState(r.status) }));
    },
  },
  meeting: {
    key: "meeting",
    labelAr: "اجتماع",
    pluralAr: "الاجتماعات",
    permission: "committees.read",
    // المسار الحقيقي يحتاج معرّف اللجنة أيضاً؛ يُبنى في resolve ويعاد عبر `href`.
    route: (id) => `/committees?اجتماع=${id}`,
    resolve: async (ids) => {
      const rows = await db
        .select({ id: meetings.id, seq: meetings.seq, title: meetings.title, status: meetings.status, committeeId: meetings.committeeId })
        .from(meetings)
        .where(inArray(meetings.id, ids));
      return rows.map((r) => ({
        id: r.id,
        labelAr: r.title ?? `الاجتماع رقم ${r.seq}`,
        locked: isLockedState(r.status),
        href: `/committees/${r.committeeId}/meetings/${r.id}`,
      }));
    },
  },
  perf_session: {
    key: "perf_session",
    labelAr: "جلسة أداء",
    pluralAr: "جلسات الأداء",
    permission: "performance.read",
    route: (id) => `/performance?جلسة=${id}`,
    resolve: async (ids) => {
      const rows = await db
        .select({ id: perfSessions.id, kind: perfSessions.sessionType, status: perfSessions.status })
        .from(perfSessions)
        .where(inArray(perfSessions.id, ids));
      return rows.map((r) => ({ id: r.id, labelAr: r.kind ?? "جلسة أداء", locked: isLockedState(r.status) }));
    },
  },
  perf_rating: {
    key: "perf_rating",
    labelAr: "تقدير مؤشر أداء",
    pluralAr: "تقديرات مؤشرات الأداء",
    permission: "performance.read",
    route: (id) => `/performance?تقدير=${id}`,
    // التقدير يتبع جلسته؛ يُعامل كسجل أداء ولا يُحذف شاهده دون المرور بحارس الجلسة.
    resolve: async (ids) => ids.map((id) => ({ id, labelAr: "تقدير مؤشر أداء", locked: true })),
  },
  room: {
    key: "room",
    labelAr: "غرفة",
    pluralAr: "الغرف",
    permission: "building.read",
    route: (id) => `/building/rooms/${id}`,
    resolve: async (ids) => {
      const rows = await db
        .select({ id: rooms.id, code: rooms.code, name: rooms.nameAr })
        .from(rooms)
        .where(inArray(rooms.id, ids));
      return rows.map((r) => ({ id: r.id, labelAr: `${r.code} — ${r.name}`, locked: false }));
    },
  },
  asset: {
    key: "asset",
    labelAr: "أصل وعهدة",
    pluralAr: "الأصول والعهد",
    permission: "building.read",
    route: (id) => `/building/assets?أصل=${id}`,
    resolve: async (ids) => {
      const rows = await db
        .select({ id: assets.id, code: assets.code, name: assets.nameAr })
        .from(assets)
        .where(inArray(assets.id, ids));
      return rows.map((r) => ({ id: r.id, labelAr: `${r.code} — ${r.name}`, locked: false }));
    },
  },
  person: {
    key: "person",
    labelAr: "منسوب",
    pluralAr: "المنسوبون",
    permission: "people.read",
    route: (id) => `/people/${id}`,
    resolve: async (ids) => {
      const rows = await db
        .select({ id: people.id, name: people.fullName })
        .from(people)
        .where(inArray(people.id, ids));
      return rows.map((r) => ({ id: r.id, labelAr: r.name, locked: false }));
    },
  },
  task: {
    key: "task",
    labelAr: "مهمة أو إجراء",
    pluralAr: "المهام والإجراءات",
    permission: "tasks.read",
    route: (id) => `/tasks?مهمة=${id}`,
    resolve: async (ids) => {
      const rows = await db
        .select({ id: actionTasks.id, title: actionTasks.title, status: actionTasks.status })
        .from(actionTasks)
        .where(inArray(actionTasks.id, ids));
      return rows.map((r) => ({ id: r.id, labelAr: r.title, locked: isLockedState(r.status) }));
    },
  },
};

export const LINKABLE_ENTITY_KEYS = Object.keys(DEFS) as LinkableEntityKey[];

export function isLinkableEntityKey(key: string): key is LinkableEntityKey {
  return Object.prototype.hasOwnProperty.call(DEFS, key);
}

export function entityDef(key: LinkableEntityKey): EntityDef {
  return DEFS[key];
}

/** المسمى العربي لأي نوع — يتحمل الأنواع غير المعروفة دون أن يكسر الواجهة. */
export function entityLabelAr(key: string): string {
  return isLinkableEntityKey(key) ? DEFS[key].labelAr : key;
}

export function entityPluralAr(key: string): string {
  return isLinkableEntityKey(key) ? DEFS[key].pluralAr : key;
}

export function entityRoute(key: string, id: string): string | null {
  return isLinkableEntityKey(key) ? DEFS[key].route(id) : null;
}

/**
 * يحل مجموعة معرّفات لنوع واحد. الأنواع غير المعروفة تُعاد «مقفلة» عمداً (fail-closed):
 * نوع لا يعرفه السجل لا يمكن الجزم بأن حذف شاهده آمن.
 */
export async function resolveEntities(key: string, ids: string[]): Promise<EntityRef[]> {
  if (ids.length === 0) return [];
  if (!isLinkableEntityKey(key)) {
    return ids.map((id) => ({ id, labelAr: `${key} (نوع غير معروف)`, locked: true }));
  }
  return DEFS[key].resolve(ids);
}

/** مسار فتح السجل، مفضّلاً المسار المبني في resolve حين يوجد. */
export function refHref(key: string, ref: EntityRef): string | null {
  return ref.href ?? entityRoute(key, ref.id);
}

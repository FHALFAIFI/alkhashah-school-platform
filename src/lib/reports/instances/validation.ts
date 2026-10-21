/**
 * فحص ما قبل التصدير والاعتماد (v2.6 §A) — وحدة خالصة تقرأ `SnapshotDoc` جاهزاً.
 *
 * التحذير لا يمنع (§A): ما يمنع هو ما يمسّ الصحة أو الأمان فقط. كل تحذير جملة عربية
 * تشرح نفسها — تقرير فارغ بسبب مرشّح يجب أن يقول ذلك، لا أن يبدو كغياب بيانات.
 */

import type { SnapshotDoc } from "./options";
import { LARGE_REPORT_ROWS } from "../export-safety";

export type InstanceWarning = {
  key: string;
  message: string;
  /** المانع يوقف الاعتماد؛ التحذير يُعرض ويُتجاوز */
  blocking: boolean;
};

export function validateDocument(doc: SnapshotDoc, opts?: { sensitive?: boolean }): InstanceWarning[] {
  const warnings: InstanceWarning[] = [];

  if (doc.sections.length === 0) {
    warnings.push({ key: "no-sections", message: "لا قسم ظاهراً في التقرير — أظهر قسماً واحداً على الأقل", blocking: true });
    return warnings;
  }

  const emptySections = doc.sections.filter((s) => s.empty);
  if (emptySections.length === doc.sections.length) {
    warnings.push({
      key: "all-empty",
      message: "كل أقسام التقرير فارغة بالمرشّحات الحالية — راجع المرشّحات أو الفترة قبل الاعتماد",
      blocking: false,
    });
  } else {
    for (const s of emptySections) {
      warnings.push({ key: `empty:${s.key}`, message: `قسم «${s.label}» فارغ بالمرشّحات الحالية`, blocking: false });
    }
  }

  for (const s of doc.sections.filter((x) => x.truncated)) {
    warnings.push({
      key: `truncated:${s.key}`,
      message: `قسم «${s.label}» مقتطع عند الحد الأقصى للصفوف — ضيّق المرشّحات ليكتمل`,
      blocking: false,
    });
  }

  if (doc.stats.totalRows > LARGE_REPORT_ROWS) {
    warnings.push({
      key: "large",
      message: `التقرير كبير (${doc.stats.totalRows} صفاً) — التوليد يجري في الخلفية ولن تتجمد الصفحة`,
      blocking: false,
    });
  }

  if (opts?.sensitive) {
    warnings.push({
      key: "sensitive",
      message: "التقرير يحمل بيانات أداء فردية بالأسماء — تعامل مع الملف المُصدَّر بسرّيته",
      blocking: false,
    });
  }

  if (doc.identity.principalName === "" && doc.sections.length > 0 && styleWantsIdentity(doc)) {
    warnings.push({
      key: "no-principal",
      message: "اسم المدير غير مُدخل في هوية الوثائق — سيظهر مربع الاعتماد بلا اسم",
      blocking: false,
    });
  }

  if (!doc.periodFrom && !doc.periodTo) {
    warnings.push({ key: "no-period", message: "لم تُحدَّد فترة للتقرير — سيُقرأ على أنه شامل لكل التواريخ", blocking: false });
  }

  return warnings;
}

function styleWantsIdentity(doc: SnapshotDoc): boolean {
  return (doc.style as { showIdentity?: boolean }).showIdentity !== false;
}

export function blockers(warnings: InstanceWarning[]): InstanceWarning[] {
  return warnings.filter((w) => w.blocking);
}

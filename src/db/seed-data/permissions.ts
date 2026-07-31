/** قائمة الأذونات — المفاتيح تقنية والأسماء عربية للعرض */
export const permissionsSeed: { key: string; nameAr: string; module: string }[] = [
  { key: "people.read", nameAr: "عرض سجل الأشخاص", module: "people" },
  { key: "people.write", nameAr: "إدارة سجل الأشخاص", module: "people" },
  { key: "people.import", nameAr: "استيراد بيانات الأشخاص", module: "people" },
  { key: "people.delete", nameAr: "حذف الأشخاص نهائياً", module: "people" },

  { key: "evidence.read", nameAr: "عرض الشواهد", module: "evidence" },
  { key: "evidence.write", nameAr: "إضافة وتعديل الشواهد", module: "evidence" },
  { key: "evidence.delete", nameAr: "حذف الشواهد", module: "evidence" },
  { key: "files.download", nameAr: "تنزيل المرفقات", module: "evidence" },

  { key: "tasks.read", nameAr: "عرض المهام والإجراءات", module: "tasks" },
  { key: "tasks.write", nameAr: "إدارة المهام والإجراءات", module: "tasks" },

  { key: "calendar.read", nameAr: "عرض التقويم", module: "calendar" },
  { key: "calendar.write", nameAr: "إدارة التقويم", module: "calendar" },
  { key: "calendar.import", nameAr: "استيراد التقويم", module: "calendar" },

  { key: "plan.read", nameAr: "عرض الخطة التشغيلية", module: "plan" },
  { key: "plan.write", nameAr: "إدارة الخطة التشغيلية", module: "plan" },
  { key: "plan.import", nameAr: "استيراد الخطة التشغيلية", module: "plan" },
  { key: "plan.approve", nameAr: "اعتماد البرامج", module: "plan" },
  { key: "plan.close_year", nameAr: "إقفال السنة وأرشفتها", module: "plan" },
  { key: "plan.override", nameAr: "إقفال البرنامج بتجاوز موثّق رغم النواقص", module: "plan" },

  { key: "committees.read", nameAr: "عرض اللجان والمجالس", module: "committees" },
  { key: "committees.write", nameAr: "إدارة اللجان والاجتماعات", module: "committees" },
  { key: "committees.approve", nameAr: "اعتماد التشكيلات والمحاضر", module: "committees" },

  { key: "performance.read", nameAr: "عرض وحدة الأداء الوظيفي", module: "performance" },
  { key: "performance.write", nameAr: "إدارة دورات وجلسات الأداء", module: "performance" },
  { key: "performance.approve", nameAr: "اعتماد سجلات الأداء", module: "performance" },
  { key: "performance.individual.read", nameAr: "الاطلاع على تفاصيل الأداء الفردي", module: "performance" },
  { key: "performance.models.manage", nameAr: "إدارة نماذج الأداء", module: "performance" },

  { key: "building.read", nameAr: "عرض التوأم الرقمي للمبنى", module: "building" },
  { key: "building.write", nameAr: "تحرير مخطط المبنى", module: "building" },
  { key: "building.publish", nameAr: "نشر نسخ الهندسة", module: "building" },
  { key: "assets.read", nameAr: "عرض العهدة والأصول", module: "building" },
  { key: "assets.write", nameAr: "إدارة العهدة والأصول", module: "building" },
  { key: "assets.import", nameAr: "استيراد العهدة", module: "building" },
  { key: "assets.delete", nameAr: "حذف الأصول نهائياً", module: "building" },
  { key: "inspections.read", nameAr: "عرض عمليات الفحص", module: "building" },
  { key: "inspections.write", nameAr: "تنفيذ عمليات الفحص", module: "building" },
  { key: "maintenance.read", nameAr: "عرض بلاغات الصيانة", module: "building" },
  { key: "maintenance.write", nameAr: "إدارة بلاغات الصيانة", module: "building" },

  { key: "reports.read", nameAr: "عرض التقارير", module: "reports" },
  { key: "reports.generate", nameAr: "إصدار التقارير", module: "reports" },
  { key: "reports.executive", nameAr: "التقارير التنفيذية الشاملة", module: "reports" },
  { key: "documents.read", nameAr: "عرض الوثائق الصادرة", module: "documents" },
  { key: "documents.issue", nameAr: "إصدار الوثائق الرسمية", module: "documents" },
  { key: "branding.use", nameAr: "استخدام التوقيع والختم", module: "documents" },

  { key: "imports.read", nameAr: "عرض دفعات الاستيراد", module: "imports" },
  { key: "imports.commit", nameAr: "تنفيذ دفعات الاستيراد", module: "imports" },
  { key: "imports.rollback", nameAr: "التراجع عن دفعات الاستيراد", module: "imports" },

  { key: "admin.users", nameAr: "إدارة المستخدمين", module: "admin" },
  { key: "admin.roles", nameAr: "إدارة الأدوار والأذونات", module: "admin" },
  { key: "admin.settings", nameAr: "إدارة إعدادات النظام", module: "admin" },
  { key: "admin.audit.read", nameAr: "عرض سجل التدقيق", module: "admin" },
  { key: "admin.backup", nameAr: "إدارة النسخ الاحتياطي", module: "admin" },
  { key: "admin.integrations", nameAr: "إدارة التكاملات الاختيارية", module: "admin" },

  { key: "feedback.create", nameAr: "إرسال ملاحظات التشغيل", module: "feedback" },
  { key: "feedback.manage", nameAr: "إدارة ومعالجة ملاحظات التشغيل", module: "feedback" },

  { key: "budget.read", nameAr: "عرض الميزانية والمصروفات", module: "budget" },
  { key: "budget.write", nameAr: "إدارة الإيرادات والمصروفات", module: "budget" },
];

/**
 * الدور: مدير المدرسة — جميع الصلاحيات التجارية بما فيها الأداء الفردي والتوقيع/الختم.
 * الدور: مسؤول النظام — يرى النظام كاملاً ويدير الإعدادات، عدا تفاصيل الأداء الفردي
 * (تبقى للمدير فقط وفق المتطلبات — DECISIONS D-013).
 */
export const rolesSeed = [
  {
    key: "principal",
    nameAr: "مدير المدرسة",
    system: true,
    permissions: permissionsSeed.map((p) => p.key),
  },
  {
    key: "sysadmin",
    nameAr: "مسؤول النظام",
    system: true,
    permissions: permissionsSeed
      .map((p) => p.key)
      // تفاصيل الأداء الفردي والتوقيع للمدير (D-013)، وتجاوز إقفال البرنامج قرار المدير وحده
      .filter((k) => k !== "performance.individual.read" && k !== "branding.use" && k !== "plan.override"),
  },
];

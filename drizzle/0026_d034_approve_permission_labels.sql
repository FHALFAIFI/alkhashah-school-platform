-- D-034 (v2.3 §3): توحيد المصطلح «اعتماد» — تحديث تسميتي صلاحيتين مرجعيتين فقط.
-- تسميات عرض لا بيانات مستخدم؛ المفاتيح والارتباطات لا تتغير، وسجل التدقيق التاريخي لا يُمس.
UPDATE "permissions" SET "name_ar" = 'اعتماد البرامج'
WHERE "key" = 'plan.approve' AND "name_ar" = 'اعتماد وإقفال البرامج';--> statement-breakpoint
UPDATE "permissions" SET "name_ar" = 'اعتماد سجلات الأداء'
WHERE "key" = 'performance.approve' AND "name_ar" = 'اعتماد وإقفال سجلات الأداء';

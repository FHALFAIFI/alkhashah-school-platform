-- v2.5.0 §4/§16 — صلاحيات منشئ التقارير وقوالبها.
--
-- لماذا هجرة بيانات لا بذرة: خدمة البذر (`seed.ts`) مقيّدة بملف تعريف ولا تعمل على
-- الإنتاج إطلاقاً (أُثبت في سجل نشر v2.4.1: صفر ورود لـ`seed.ts` في التهيئة المُركّبة).
-- فالصلاحية التي تُضاف إلى `permissionsSeed` وحدها لا تصل إلى قاعدة الإنتاج أبداً، ويبقى
-- المدير بلا صلاحية للميزة التي طلبها. تُضاف هنا وتُمنح للأدوار القائمة بالمنطق نفسه
-- الذي تتبعه البذرة: «مدير المدرسة» يأخذ كل الصلاحيات، و«مسؤول النظام» يأخذها عدا
-- المستثنيات المعروفة (D-013: تفاصيل الأداء الفردي، والتوقيع/الختم، وتجاوز الإقفال).
--
-- الهجرة **متكرّرة التنفيذ بأمان**: كل عبارة `ON CONFLICT DO NOTHING`، ولا صفّ قائم
-- يُحدَّث أو يُحذف، ولا دور يفقد صلاحية.

INSERT INTO "permissions" ("key", "name_ar", "module") VALUES
  ('reports.builder', 'استخدام منشئ التقارير', 'reports'),
  ('reports.templates.share', 'مشاركة قوالب التقارير', 'reports'),
  ('reports.templates.global', 'إدارة قوالب التقارير العامة', 'reports')
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

-- مدير المدرسة: الصلاحيات الثلاث
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r, "permissions" p
WHERE r."key" = 'principal'
  AND p."key" IN ('reports.builder', 'reports.templates.share', 'reports.templates.global')
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- مسؤول النظام: الثلاث كذلك — لا واحدة منها تكشف تفاصيل أداء فردي، لأن تشغيل أي قالب
-- يفحص صلاحية التقرير المصدر نفسه، و`performance.individual.read` تبقى محجوبة عنه.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r, "permissions" p
WHERE r."key" = 'sysadmin'
  AND p."key" IN ('reports.builder', 'reports.templates.share', 'reports.templates.global')
ON CONFLICT DO NOTHING;

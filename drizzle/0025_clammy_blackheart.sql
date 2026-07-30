CREATE TABLE "inspection_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"label" text NOT NULL,
	"note" text,
	"severity" text DEFAULT 'متوسط' NOT NULL,
	"critical" boolean DEFAULT false NOT NULL,
	"responsible_person_id" uuid,
	"responsible_text" text,
	"target_date" text,
	"status" text DEFAULT 'يحتاج معالجة' NOT NULL,
	"resolution_note" text,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"maintenance_issue_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"note" text,
	"actor_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label_ar" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_types_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "maintenance_issues" ALTER COLUMN "status" SET DEFAULT 'مسودة';--> statement-breakpoint
ALTER TABLE "maintenance_issues" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "maintenance_issues" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "maintenance_issues" ADD COLUMN "sent_to" text;--> statement-breakpoint
ALTER TABLE "maintenance_issues" ADD COLUMN "sent_at" text;--> statement-breakpoint
ALTER TABLE "maintenance_issues" ADD COLUMN "visit_date" text;--> statement-breakpoint
ALTER TABLE "maintenance_issues" ADD COLUMN "action_taken" text;--> statement-breakpoint
ALTER TABLE "maintenance_issues" ADD COLUMN "resolution" text;--> statement-breakpoint
ALTER TABLE "maintenance_issues" ADD COLUMN "closure_reason" text;--> statement-breakpoint
ALTER TABLE "maintenance_issues" ADD COLUMN "followup_recommendation" text;--> statement-breakpoint
ALTER TABLE "maintenance_issues" ADD COLUMN "escalation_needed" boolean;--> statement-breakpoint
ALTER TABLE "maintenance_issues" ADD COLUMN "inspection_finding_id" uuid;--> statement-breakpoint
ALTER TABLE "maintenance_issues" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "inspection_findings" ADD CONSTRAINT "inspection_findings_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_findings" ADD CONSTRAINT "inspection_findings_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_findings" ADD CONSTRAINT "inspection_findings_responsible_person_id_people_id_fk" FOREIGN KEY ("responsible_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_findings" ADD CONSTRAINT "inspection_findings_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_findings" ADD CONSTRAINT "inspection_findings_maintenance_issue_id_maintenance_issues_id_fk" FOREIGN KEY ("maintenance_issue_id") REFERENCES "public"."maintenance_issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_status_history" ADD CONSTRAINT "maintenance_status_history_issue_id_maintenance_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."maintenance_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_status_history" ADD CONSTRAINT "maintenance_status_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inspection_findings_room_idx" ON "inspection_findings" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "inspection_findings_status_idx" ON "inspection_findings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "inspection_findings_inspection_idx" ON "inspection_findings" USING btree ("inspection_id");--> statement-breakpoint
CREATE INDEX "maintenance_history_issue_idx" ON "maintenance_status_history" USING btree ("issue_id");--> statement-breakpoint
ALTER TABLE "maintenance_issues" ADD CONSTRAINT "maintenance_issues_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- D-037: سجل أنواع الغرف الموحّد — صفوف نظامية في جدول جديد فارغ (لا سجل قائم يُمس).
-- الأسماء التاريخية في aliases فتُحلّ إلى النوع نفسه دون إعادة كتابة أي غرفة.
INSERT INTO "room_types" ("key", "label_ar", "aliases", "sort_order", "is_system") VALUES
('classroom', 'فصل دراسي', '[]'::jsonb, 0, true),
('computer-lab', 'مختبر حاسب', '["معمل حاسب","مختبر الحاسب"]'::jsonb, 1, true),
('science-lab', 'مختبر علوم', '["معمل","مختبر","معمل علوم"]'::jsonb, 2, true),
('library', 'مكتبة', '["مصادر تعلم","مركز مصادر"]'::jsonb, 3, true),
('admin-office', 'مكتب إداري', '[]'::jsonb, 4, true),
('teachers-room', 'غرفة معلمين', '[]'::jsonb, 5, true),
('storage', 'مستودع', '[]'::jsonb, 6, true),
('wc', 'دورة مياه', '["دورات مياه"]'::jsonb, 7, true),
('yard', 'ساحة', '["ساحة طابور"]'::jsonb, 8, true),
('corridor', 'ممر', '[]'::jsonb, 9, true),
('stairs', 'درج', '["سلم"]'::jsonb, 10, true),
('prayer-room', 'مصلى', '[]'::jsonb, 11, true),
('electrical-room', 'غرفة كهرباء', '["مرفق كهرباء"]'::jsonb, 12, true),
('safety-room', 'غرفة أمن وسلامة', '["مرفق سلامة"]'::jsonb, 13, true),
('multipurpose-hall', 'قاعة متعددة الأغراض', '[]'::jsonb, 14, true),
('playground', 'ملعب', '[]'::jsonb, 15, true),
('entrance', 'مدخل', '["بوابة"]'::jsonb, 16, true),
('emergency-exit', 'مخرج طوارئ', '[]'::jsonb, 17, true),
('canopy', 'مظلة', '[]'::jsonb, 18, true),
('water-facility', 'مرفق مياه', '[]'::jsonb, 19, true),
('network-facility', 'مرفق شبكة', '[]'::jsonb, 20, true),
('external-facility', 'مرفق خارجي', '[]'::jsonb, 21, true),
('services', 'خدمات', '[]'::jsonb, 22, true),
('other', 'أخرى', '[]'::jsonb, 23, true)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- D-036: ترحيل حالات البلاغات القديمة إلى مفردات دورة الحياة الجديدة — تحويل موثّق
-- ومسجَّل: صف تاريخ لكل بلاغ يتحوّل، فالقيمة القديمة قابلة للاسترجاع دائماً من السجل.
-- الخريطة: مفتوح←معتمد، قيد الإصلاح←تحت المعالجة، تم الإصلاح←تم الإصلاح (بلا تغيير)،
-- مغلق ومتحقق←مغلق (مع resolution=تم الإصلاح لأنه كان مُصلحاً ومتحققاً منه).
INSERT INTO "maintenance_status_history" ("issue_id", "from_status", "to_status", "note")
SELECT "id", "status",
  CASE "status"
    WHEN 'مفتوح' THEN 'معتمد'
    WHEN 'قيد الإصلاح' THEN 'تحت المعالجة'
    WHEN 'مغلق ومتحقق' THEN 'مغلق'
  END,
  'ترحيل D-036 من مفردات ما قبل v2.3'
FROM "maintenance_issues"
WHERE "status" IN ('مفتوح', 'قيد الإصلاح', 'مغلق ومتحقق');--> statement-breakpoint
UPDATE "maintenance_issues" SET "resolution" = 'تم الإصلاح'
WHERE "status" IN ('تم الإصلاح', 'مغلق ومتحقق');--> statement-breakpoint
UPDATE "maintenance_issues" SET "status" =
  CASE "status"
    WHEN 'مفتوح' THEN 'معتمد'
    WHEN 'قيد الإصلاح' THEN 'تحت المعالجة'
    WHEN 'مغلق ومتحقق' THEN 'مغلق'
    ELSE "status"
  END
WHERE "status" IN ('مفتوح', 'قيد الإصلاح', 'مغلق ومتحقق');

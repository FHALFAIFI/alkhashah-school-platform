CREATE TABLE "template_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_type" text NOT NULL,
	"name_ar" text,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"current_version_id" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"config" jsonb NOT NULL,
	"status" text DEFAULT 'مسودة' NOT NULL,
	"change_note" text,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "template_version_id" uuid;--> statement-breakpoint
ALTER TABLE "template_definitions" ADD CONSTRAINT "template_definitions_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_definitions" ADD CONSTRAINT "template_definitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_definitions" ADD CONSTRAINT "template_definitions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_template_id_template_definitions_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "template_definitions_type_idx" ON "template_definitions" USING btree ("doc_type");--> statement-breakpoint
CREATE UNIQUE INDEX "template_default_per_type_unique" ON "template_definitions" USING btree ("doc_type") WHERE "template_definitions"."is_default" = true and "template_definitions"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "template_version_unique" ON "template_versions" USING btree ("template_id","version_number");--> statement-breakpoint
CREATE INDEX "template_versions_template_idx" ON "template_versions" USING btree ("template_id");
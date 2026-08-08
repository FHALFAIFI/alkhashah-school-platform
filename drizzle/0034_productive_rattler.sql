CREATE TABLE "report_counters" (
	"year_key" text PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"type_key" text NOT NULL,
	"status" text DEFAULT 'مسودة' NOT NULL,
	"report_number" text,
	"version_of_id" uuid,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"period_from" text,
	"period_to" text,
	"snapshot" jsonb,
	"sensitive" boolean DEFAULT false NOT NULL,
	"signed_copy_file_id" uuid,
	"finalized_at" timestamp with time zone,
	"finalized_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"formats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'قيد الانتظار' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"error" text,
	"requested_by" uuid,
	"started_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"format" text NOT NULL,
	"file_id" uuid NOT NULL,
	"checksum" text,
	"size" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_style_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"base_key" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_instances" ADD CONSTRAINT "report_instances_version_of_id_report_instances_id_fk" FOREIGN KEY ("version_of_id") REFERENCES "public"."report_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_instances" ADD CONSTRAINT "report_instances_signed_copy_file_id_stored_files_id_fk" FOREIGN KEY ("signed_copy_file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_instances" ADD CONSTRAINT "report_instances_finalized_by_users_id_fk" FOREIGN KEY ("finalized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_instances" ADD CONSTRAINT "report_instances_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_instances" ADD CONSTRAINT "report_instances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_instances" ADD CONSTRAINT "report_instances_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_instance_id_report_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."report_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_outputs" ADD CONSTRAINT "report_outputs_instance_id_report_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."report_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_outputs" ADD CONSTRAINT "report_outputs_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_style_templates" ADD CONSTRAINT "report_style_templates_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_style_templates" ADD CONSTRAINT "report_style_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_style_templates" ADD CONSTRAINT "report_style_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_instances_number_unique" ON "report_instances" USING btree ("report_number");--> statement-breakpoint
CREATE INDEX "report_instances_status_idx" ON "report_instances" USING btree ("status");--> statement-breakpoint
CREATE INDEX "report_instances_type_idx" ON "report_instances" USING btree ("type_key");--> statement-breakpoint
CREATE INDEX "report_instances_created_idx" ON "report_instances" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "report_jobs_instance_idx" ON "report_jobs" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "report_jobs_status_idx" ON "report_jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "report_outputs_instance_format_unique" ON "report_outputs" USING btree ("instance_id","format");--> statement-breakpoint
CREATE INDEX "report_style_templates_base_idx" ON "report_style_templates" USING btree ("base_key");
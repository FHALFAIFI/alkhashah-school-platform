CREATE TABLE "perf_signed_report_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"file_id" uuid NOT NULL,
	"reason" text,
	"replaced_by" uuid,
	"replaced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "perf_sessions" ADD COLUMN "principal_comment" text;--> statement-breakpoint
ALTER TABLE "perf_sessions" ADD COLUMN "employee_comment" text;--> statement-breakpoint
ALTER TABLE "perf_sessions" ADD COLUMN "recommendations" text;--> statement-breakpoint
ALTER TABLE "perf_sessions" ADD COLUMN "evaluation_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "perf_signed_report_versions" ADD CONSTRAINT "perf_signed_report_versions_session_id_perf_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."perf_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perf_signed_report_versions" ADD CONSTRAINT "perf_signed_report_versions_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perf_signed_report_versions" ADD CONSTRAINT "perf_signed_report_versions_replaced_by_users_id_fk" FOREIGN KEY ("replaced_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "perf_signed_versions_session_idx" ON "perf_signed_report_versions" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "perf_signed_versions_unique" ON "perf_signed_report_versions" USING btree ("session_id","version");
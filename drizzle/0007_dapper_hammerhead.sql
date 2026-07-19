-- Human-readable feedback reference numbers (FB-0001, FB-0002, …) come from this
-- sequence via the "ref" column default below. Created first so the DEFAULT resolves.
CREATE SEQUENCE IF NOT EXISTS "feedback_ref_seq" START WITH 1 INCREMENT BY 1;--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text DEFAULT 'FB-' || lpad(nextval('feedback_ref_seq')::text, 4, '0') NOT NULL,
	"created_by" uuid,
	"page_path" text NOT NULL,
	"module" text NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"attempted" text,
	"happened" text,
	"expected" text,
	"blocked" boolean DEFAULT false NOT NULL,
	"attachment_file_id" uuid,
	"device_class" text,
	"viewport" text,
	"browser" text,
	"app_version" text,
	"status" text DEFAULT 'جديدة' NOT NULL,
	"review_note" text,
	"resolution_note" text,
	"resolved_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"archive_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_attachment_file_id_stored_files_id_fk" FOREIGN KEY ("attachment_file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_status_idx" ON "feedback" USING btree ("status");--> statement-breakpoint
CREATE INDEX "feedback_module_idx" ON "feedback" USING btree ("module");--> statement-breakpoint
CREATE INDEX "feedback_created_idx" ON "feedback" USING btree ("created_at");
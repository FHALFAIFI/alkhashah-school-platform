CREATE TABLE "committee_impacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"committee_id" uuid NOT NULL,
	"meeting_id" uuid,
	"outcome_id" uuid,
	"task_id" uuid,
	"result" text NOT NULL,
	"impact" text NOT NULL,
	"measurement" text,
	"observed_at" timestamp with time zone,
	"evidence_file_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"file_id" uuid NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name_ar" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_types_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "type_id" uuid;--> statement-breakpoint
ALTER TABLE "committee_impacts" ADD CONSTRAINT "committee_impacts_committee_id_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."committees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_impacts" ADD CONSTRAINT "committee_impacts_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_impacts" ADD CONSTRAINT "committee_impacts_outcome_id_meeting_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."meeting_outcomes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_impacts" ADD CONSTRAINT "committee_impacts_task_id_action_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."action_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_impacts" ADD CONSTRAINT "committee_impacts_evidence_file_id_stored_files_id_fk" FOREIGN KEY ("evidence_file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_impacts" ADD CONSTRAINT "committee_impacts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attachments" ADD CONSTRAINT "meeting_attachments_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attachments" ADD CONSTRAINT "meeting_attachments_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attachments" ADD CONSTRAINT "meeting_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "committee_impacts_committee_idx" ON "committee_impacts" USING btree ("committee_id");--> statement-breakpoint
CREATE INDEX "meeting_attachments_meeting_idx" ON "meeting_attachments" USING btree ("meeting_id");--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_type_id_meeting_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."meeting_types"("id") ON DELETE no action ON UPDATE no action;
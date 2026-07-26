CREATE TABLE "committee_task_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"committee_id" uuid NOT NULL,
	"title" text NOT NULL,
	"assigned_member_id" uuid,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"excluded" boolean DEFAULT false NOT NULL,
	"from_template_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "committee_task_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_key" text NOT NULL,
	"title" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meeting_types" ADD COLUMN "requires_signature" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "committee_task_assignments" ADD CONSTRAINT "committee_task_assignments_committee_id_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."committees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_task_assignments" ADD CONSTRAINT "committee_task_assignments_assigned_member_id_committee_members_id_fk" FOREIGN KEY ("assigned_member_id") REFERENCES "public"."committee_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "committee_task_assignments_committee_idx" ON "committee_task_assignments" USING btree ("committee_id");--> statement-breakpoint
CREATE INDEX "committee_task_templates_key_idx" ON "committee_task_templates" USING btree ("template_key");
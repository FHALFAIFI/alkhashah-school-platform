CREATE TABLE "activity_deliverables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"required" boolean DEFAULT true NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_evidence_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"label" text NOT NULL,
	"required_role" text,
	"min_count" integer DEFAULT 1 NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_state_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"event" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"from_progress" integer,
	"to_progress" integer,
	"reason" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"migrated_from_milestone_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"owner_person_id" uuid,
	"planned_start" text,
	"planned_end" text,
	"actual_start" text,
	"actual_end" text,
	"status" text DEFAULT 'لم يبدأ' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"weight" integer,
	"required_for_completion" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"completed_by" uuid,
	"completed_at" timestamp with time zone,
	"cancel_reason" text,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"archived_reason" text,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "weighting_mode" text DEFAULT 'متساوٍ' NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "completed_by" uuid;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "completion_override" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "override_reason" text;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "override_by" uuid;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "override_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "override_readiness" integer;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "override_missing" jsonb;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "archived_reason" text;--> statement-breakpoint
ALTER TABLE "activity_deliverables" ADD CONSTRAINT "activity_deliverables_activity_id_program_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."program_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_deliverables" ADD CONSTRAINT "activity_deliverables_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_evidence_requirements" ADD CONSTRAINT "activity_evidence_requirements_activity_id_program_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."program_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_state_history" ADD CONSTRAINT "activity_state_history_activity_id_program_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."program_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_state_history" ADD CONSTRAINT "activity_state_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_activities" ADD CONSTRAINT "program_activities_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_activities" ADD CONSTRAINT "program_activities_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_activities" ADD CONSTRAINT "program_activities_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_activities" ADD CONSTRAINT "program_activities_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_activities" ADD CONSTRAINT "program_activities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_deliverables_activity_idx" ON "activity_deliverables" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "activity_evidence_req_activity_idx" ON "activity_evidence_requirements" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "activity_history_activity_idx" ON "activity_state_history" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "activities_program_idx" ON "program_activities" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "activities_owner_idx" ON "program_activities" USING btree ("owner_person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "activities_migrated_milestone_unique" ON "program_activities" USING btree ("migrated_from_milestone_id");--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_override_by_users_id_fk" FOREIGN KEY ("override_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
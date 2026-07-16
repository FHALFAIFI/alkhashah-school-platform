CREATE TABLE "program_followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"week_key" text NOT NULL,
	"note" text NOT NULL,
	"progress_snapshot" integer DEFAULT 0 NOT NULL,
	"execution_status" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "program_followups" ADD CONSTRAINT "program_followups_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_followups" ADD CONSTRAINT "program_followups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "followups_program_week_unique" ON "program_followups" USING btree ("program_id","week_key");--> statement-breakpoint
CREATE INDEX "followups_program_idx" ON "program_followups" USING btree ("program_id");
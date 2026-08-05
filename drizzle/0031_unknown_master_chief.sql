ALTER TABLE "program_followups" ADD COLUMN "completed_work" text;--> statement-breakpoint
ALTER TABLE "program_followups" ADD COLUMN "obstacles" text;--> statement-breakpoint
ALTER TABLE "program_followups" ADD COLUMN "required_action" text;--> statement-breakpoint
ALTER TABLE "program_followups" ADD COLUMN "next_step" text;--> statement-breakpoint
ALTER TABLE "program_followups" ADD COLUMN "evidence_update" text;--> statement-breakpoint
ALTER TABLE "program_followups" ADD COLUMN "intervention_needed" boolean DEFAULT false NOT NULL;
ALTER TABLE "program_closure_history" ADD COLUMN "from_status" text;--> statement-breakpoint
ALTER TABLE "program_closure_history" ADD COLUMN "to_status" text;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "completion_note" text;
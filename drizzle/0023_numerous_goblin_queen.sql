ALTER TABLE "stored_files" ADD COLUMN "acceptance_status" text;--> statement-breakpoint
ALTER TABLE "stored_files" ADD COLUMN "acceptance_mode" text;--> statement-breakpoint
ALTER TABLE "stored_files" ADD COLUMN "accepted_by" uuid;--> statement-breakpoint
ALTER TABLE "stored_files" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
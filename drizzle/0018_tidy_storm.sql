CREATE TABLE "program_closure_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"action" text NOT NULL,
	"note" text,
	"actor_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "closed_by" uuid;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "closure_note" text;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "reopened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "reopened_by" uuid;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "program_closure_history" ADD CONSTRAINT "program_closure_history_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_closure_history" ADD CONSTRAINT "program_closure_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "program_closure_history_program_idx" ON "program_closure_history" USING btree ("program_id","at");--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_reopened_by_users_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
CREATE TABLE "deletion_tombstones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"display_ref" text NOT NULL,
	"reason" text NOT NULL,
	"counts" jsonb,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_edit_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"field" text NOT NULL,
	"field_label" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"approval_status_at_edit" text NOT NULL,
	"lifecycle_at_edit" text NOT NULL,
	"reason" text,
	"actor_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deletion_tombstones" ADD CONSTRAINT "deletion_tombstones_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_edit_history" ADD CONSTRAINT "program_edit_history_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_edit_history" ADD CONSTRAINT "program_edit_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deletion_tombstones_entity_idx" ON "deletion_tombstones" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "deletion_tombstones_created_idx" ON "deletion_tombstones" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "program_edit_history_program_idx" ON "program_edit_history" USING btree ("program_id","at");
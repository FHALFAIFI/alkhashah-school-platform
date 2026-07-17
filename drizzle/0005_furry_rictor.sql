CREATE TABLE "archive_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reason" text NOT NULL,
	"confirmation_text" text NOT NULL,
	"status" text DEFAULT 'مؤرشف' NOT NULL,
	"counts" jsonb,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unarchived_at" timestamp with time zone,
	"unarchived_by" uuid
);
--> statement-breakpoint
CREATE TABLE "archived_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"reason" text,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "archive_batches" ADD CONSTRAINT "archive_batches_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_batches" ADD CONSTRAINT "archive_batches_unarchived_by_users_id_fk" FOREIGN KEY ("unarchived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archived_records" ADD CONSTRAINT "archived_records_batch_id_archive_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."archive_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "archive_batches_status_idx" ON "archive_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "archived_records_batch_idx" ON "archived_records" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "archived_records_entity_idx" ON "archived_records" USING btree ("entity_type","entity_id");
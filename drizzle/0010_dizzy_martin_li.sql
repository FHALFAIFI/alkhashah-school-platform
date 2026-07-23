CREATE TABLE "evidence_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"kind" text NOT NULL,
	"file_id" uuid,
	"url" text,
	"text_content" text,
	"title" text,
	"reason" text NOT NULL,
	"replaced_by" uuid,
	"replaced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evidence_items" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD COLUMN "archived_reason" text;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD COLUMN "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "employee_type" text;--> statement-breakpoint
ALTER TABLE "evidence_versions" ADD CONSTRAINT "evidence_versions_evidence_id_evidence_items_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_versions" ADD CONSTRAINT "evidence_versions_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_versions" ADD CONSTRAINT "evidence_versions_replaced_by_users_id_fk" FOREIGN KEY ("replaced_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_versions_evidence_idx" ON "evidence_versions" USING btree ("evidence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_versions_unique" ON "evidence_versions" USING btree ("evidence_id","version");--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
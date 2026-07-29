CREATE TABLE "plan_swot_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_year_id" uuid NOT NULL,
	"category" text NOT NULL,
	"code" text NOT NULL,
	"item" text NOT NULL,
	"implication" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"import_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_swot_items" ADD CONSTRAINT "plan_swot_items_plan_year_id_plan_years_id_fk" FOREIGN KEY ("plan_year_id") REFERENCES "public"."plan_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_swot_items" ADD CONSTRAINT "plan_swot_items_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_swot_year_idx" ON "plan_swot_items" USING btree ("plan_year_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_swot_year_code_unique" ON "plan_swot_items" USING btree ("plan_year_id","code");
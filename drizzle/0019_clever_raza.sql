CREATE TABLE "financial_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_ar" text,
	"allocated_amount" numeric,
	"color" text,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_expenses" ADD COLUMN "financial_item_id" uuid;--> statement-breakpoint
ALTER TABLE "budget_expenses" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "budget_expenses" ADD COLUMN "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "budget_income" ADD COLUMN "financial_item_id" uuid;--> statement-breakpoint
ALTER TABLE "budget_income" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "budget_income" ADD COLUMN "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "financial_items" ADD CONSTRAINT "financial_items_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_items" ADD CONSTRAINT "financial_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "financial_items_order_idx" ON "financial_items" USING btree ("sort_order");--> statement-breakpoint
ALTER TABLE "budget_expenses" ADD CONSTRAINT "budget_expenses_financial_item_id_financial_items_id_fk" FOREIGN KEY ("financial_item_id") REFERENCES "public"."financial_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_expenses" ADD CONSTRAINT "budget_expenses_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_income" ADD CONSTRAINT "budget_income_financial_item_id_financial_items_id_fk" FOREIGN KEY ("financial_item_id") REFERENCES "public"."financial_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_income" ADD CONSTRAINT "budget_income_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_expenses_item_idx" ON "budget_expenses" USING btree ("financial_item_id");--> statement-breakpoint
CREATE INDEX "budget_expenses_date_idx" ON "budget_expenses" USING btree ("expense_date");--> statement-breakpoint
CREATE INDEX "budget_income_item_idx" ON "budget_income" USING btree ("financial_item_id");
ALTER TABLE "budget_expenses" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "budget_income" ADD COLUMN "payment_reference" text;--> statement-breakpoint
ALTER TABLE "budget_income" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "budget_expenses" ADD CONSTRAINT "budget_expenses_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_income" ADD CONSTRAINT "budget_income_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
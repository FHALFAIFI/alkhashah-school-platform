CREATE TABLE "budget_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_year_id" uuid NOT NULL,
	"expense_date" text,
	"program_id" uuid,
	"activity_id" uuid,
	"category" text,
	"items" text,
	"supplier" text,
	"amount" numeric NOT NULL,
	"payment_reference" text,
	"responsible_person_id" uuid,
	"notes" text,
	"overspend_acknowledged" boolean DEFAULT false NOT NULL,
	"overspend_ack_reason" text,
	"overspend_ack_by" uuid,
	"overspend_ack_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_income" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_year_id" uuid NOT NULL,
	"source" text NOT NULL,
	"income_date" text,
	"amount" numeric NOT NULL,
	"purpose" text,
	"period_text" text,
	"program_id" uuid,
	"activity_id" uuid,
	"notes" text,
	"status" text DEFAULT 'مستلم' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_expenses" ADD CONSTRAINT "budget_expenses_plan_year_id_plan_years_id_fk" FOREIGN KEY ("plan_year_id") REFERENCES "public"."plan_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_expenses" ADD CONSTRAINT "budget_expenses_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_expenses" ADD CONSTRAINT "budget_expenses_activity_id_program_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."program_activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_expenses" ADD CONSTRAINT "budget_expenses_responsible_person_id_people_id_fk" FOREIGN KEY ("responsible_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_expenses" ADD CONSTRAINT "budget_expenses_overspend_ack_by_users_id_fk" FOREIGN KEY ("overspend_ack_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_expenses" ADD CONSTRAINT "budget_expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_income" ADD CONSTRAINT "budget_income_plan_year_id_plan_years_id_fk" FOREIGN KEY ("plan_year_id") REFERENCES "public"."plan_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_income" ADD CONSTRAINT "budget_income_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_income" ADD CONSTRAINT "budget_income_activity_id_program_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."program_activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_income" ADD CONSTRAINT "budget_income_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_expenses_year_idx" ON "budget_expenses" USING btree ("plan_year_id");--> statement-breakpoint
CREATE INDEX "budget_expenses_program_idx" ON "budget_expenses" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "budget_income_year_idx" ON "budget_income" USING btree ("plan_year_id");--> statement-breakpoint
CREATE INDEX "budget_income_program_idx" ON "budget_income" USING btree ("program_id");
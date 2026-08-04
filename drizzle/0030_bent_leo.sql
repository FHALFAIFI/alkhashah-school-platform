ALTER TABLE "maintenance_issues" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "maintenance_issues" ADD COLUMN "safety_impact" text;--> statement-breakpoint
ALTER TABLE "maintenance_issues" ADD COLUMN "operational_impact" text;--> statement-breakpoint
ALTER TABLE "maintenance_issues" ADD COLUMN "requested_action" text;
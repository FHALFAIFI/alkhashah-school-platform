ALTER TABLE "inspection_templates" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "inspection_templates" ADD COLUMN "root_id" uuid;--> statement-breakpoint
ALTER TABLE "inspection_templates" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "inspection_templates" ADD COLUMN "purpose" text;--> statement-breakpoint
ALTER TABLE "inspection_templates" ADD COLUMN "instructions" text;--> statement-breakpoint
ALTER TABLE "inspection_templates" ADD COLUMN "sections" jsonb;--> statement-breakpoint
ALTER TABLE "inspection_templates" ADD COLUMN "assignment" jsonb;--> statement-breakpoint
ALTER TABLE "inspection_templates" ADD COLUMN "is_system" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inspection_templates" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "template_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "template_version" integer;
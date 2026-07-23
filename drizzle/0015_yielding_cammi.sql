CREATE TABLE "facility_checklist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_type" text NOT NULL,
	"kind" text DEFAULT 'معياري' NOT NULL,
	"status" text DEFAULT 'غير موجود' NOT NULL,
	"required_qty" integer,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facility_room_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"room_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "facility_checklist" ADD CONSTRAINT "facility_checklist_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_room_links" ADD CONSTRAINT "facility_room_links_facility_id_facility_checklist_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facility_checklist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_room_links" ADD CONSTRAINT "facility_room_links_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "facility_checklist_status_idx" ON "facility_checklist" USING btree ("status");--> statement-breakpoint
CREATE INDEX "facility_room_links_facility_idx" ON "facility_room_links" USING btree ("facility_id");--> statement-breakpoint
CREATE UNIQUE INDEX "facility_room_links_unique" ON "facility_room_links" USING btree ("facility_id","room_id");
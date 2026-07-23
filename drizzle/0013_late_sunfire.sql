ALTER TABLE "committee_members" ADD COLUMN "effective_from" text;--> statement-breakpoint
ALTER TABLE "committee_members" ADD COLUMN "effective_to" text;--> statement-breakpoint
ALTER TABLE "committee_members" ADD COLUMN "end_reason" text;--> statement-breakpoint
ALTER TABLE "committees" ADD COLUMN "assignment_doc_id" uuid;--> statement-breakpoint
ALTER TABLE "committees" ADD COLUMN "signed_assignment_file_id" uuid;--> statement-breakpoint
ALTER TABLE "committees" ADD CONSTRAINT "committees_assignment_doc_id_documents_id_fk" FOREIGN KEY ("assignment_doc_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committees" ADD CONSTRAINT "committees_signed_assignment_file_id_stored_files_id_fk" FOREIGN KEY ("signed_assignment_file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;
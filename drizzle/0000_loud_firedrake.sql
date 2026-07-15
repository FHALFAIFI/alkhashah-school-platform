CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"summary" text,
	"detail" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"kind" text DEFAULT 'info' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name_ar" text NOT NULL,
	"module" text NOT NULL,
	CONSTRAINT "permissions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "record_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"snapshot" jsonb NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name_ar" text NOT NULL,
	"description" text,
	"system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"csrf_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"recovery_codes" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "action_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"owner_person_id" uuid,
	"owner_text" text,
	"due_date" timestamp with time zone,
	"priority" text DEFAULT 'متوسطة' NOT NULL,
	"status" text DEFAULT 'جديدة' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"mandatory" boolean DEFAULT false NOT NULL,
	"source_type" text,
	"source_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_number" text NOT NULL,
	"verification_code" text NOT NULL,
	"doc_type" text NOT NULL,
	"title" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"html_snapshot" text,
	"pdf_file_id" uuid,
	"with_signature" boolean DEFAULT false NOT NULL,
	"with_stamp" boolean DEFAULT false NOT NULL,
	"issued_by" uuid,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_doc_number_unique" UNIQUE("doc_number"),
	CONSTRAINT "documents_verification_code_unique" UNIQUE("verification_code")
);
--> statement-breakpoint
CREATE TABLE "evidence_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"file_id" uuid,
	"url" text,
	"text_content" text,
	"description" text,
	"source" text,
	"role" text,
	"evidence_type" text,
	"origin" text,
	"issuer" text,
	"evidence_date" text,
	"review_status" text DEFAULT 'لم يراجع' NOT NULL,
	"review_note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"sub_key" text,
	"linked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_type" text NOT NULL,
	"source_file_name" text NOT NULL,
	"source_file_id" uuid,
	"status" text DEFAULT 'معاينة' NOT NULL,
	"column_mapping" jsonb,
	"options" jsonb,
	"summary" jsonb,
	"error_log" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	"committed_by" uuid,
	"rolled_back_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_index" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"mapped" jsonb,
	"corrections" jsonb,
	"validation" jsonb,
	"status" text DEFAULT 'جاهز' NOT NULL,
	"created_entity_type" text,
	"created_entity_id" uuid
);
--> statement-breakpoint
CREATE TABLE "stored_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"original_name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_path" text NOT NULL,
	"scope" text DEFAULT 'attachments' NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stored_files_storage_path_unique" UNIQUE("storage_path")
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"name_ar" text NOT NULL,
	"day_text" text,
	"hijri_from" text,
	"hijri_to" text,
	"gregorian_text" text,
	"greg_from" text,
	"greg_to" text,
	"impact" text,
	"school_action" text,
	"is_holiday" boolean DEFAULT false NOT NULL,
	"anchor_key" text
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name_ar" text NOT NULL,
	"calendar_type" text NOT NULL,
	"status" text DEFAULT 'مسودة' NOT NULL,
	"import_batch_id" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendars_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"category" text NOT NULL,
	"job_title" text,
	"cadre" text,
	"employment_status" text,
	"job_number" text,
	"org_unit" text,
	"email" text,
	"active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"deactivate_reason" text,
	"suggested_model_key" text,
	"import_batch_id" uuid,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_ar" text NOT NULL,
	"region" text,
	"office" text,
	"lat" text,
	"lng" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name_ar" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "stages_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "plan_budget_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_year_id" uuid NOT NULL,
	"item" text NOT NULL,
	"amount" numeric,
	"ratio" numeric,
	"rule" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "plan_years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name_ar" text NOT NULL,
	"calendar_id" uuid,
	"calendar_snapshot" jsonb,
	"status" text DEFAULT 'نشطة' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_years_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "program_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"field" text NOT NULL,
	"field_label" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"reason" text NOT NULL,
	"status" text DEFAULT 'قيد الاعتماد' NOT NULL,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_deliverables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"output_type" text,
	"main_output" text,
	"support_output" text,
	"expected_external_evidence" text,
	"accepted_evidence" text,
	"requires_external" boolean DEFAULT false NOT NULL,
	"prep_owner" text,
	"keep_owner" text,
	"due_text" text,
	"storage_place" text,
	"package_number" text,
	"min_package_rule" text,
	"package_status" text DEFAULT 'غير مكتملة' NOT NULL,
	"package_decision" text DEFAULT 'غير معتمد' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"principal_notes" text
);
--> statement-breakpoint
CREATE TABLE "program_kpis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_year_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"baseline" text,
	"target" text,
	"periodicity" text,
	"owner" text,
	"data_source" text,
	"direction" text,
	"measure_dates" text,
	"review_decision" text
);
--> statement-breakpoint
CREATE TABLE "program_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"weight" integer DEFAULT 0 NOT NULL,
	"due_text" text,
	"status" text DEFAULT 'لم يبدأ' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "program_risks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_year_id" uuid NOT NULL,
	"code" text NOT NULL,
	"risk" text NOT NULL,
	"likelihood" text,
	"impact" text,
	"classification" text,
	"treatment" text,
	"owner" text
);
--> statement-breakpoint
CREATE TABLE "program_roadmap_cells" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"period_label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"phase" text
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_year_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"domain" text NOT NULL,
	"general_goal" text,
	"specific_goal" text,
	"name" text NOT NULL,
	"rationale" text,
	"target_group" text,
	"mechanism" text,
	"period_text" text,
	"owner_position" text,
	"owner_person_id" uuid,
	"participants" text,
	"kpi_text" text,
	"target_text" text,
	"deliverable_text" text,
	"evidence_text" text,
	"followup_text" text,
	"external_relation" text,
	"expected_impact" text,
	"budget" numeric,
	"priority" text,
	"baseline_text" text,
	"indicator_text" text,
	"execution_stage" text,
	"hijri_start" text,
	"hijri_end" text,
	"pause_periods" text,
	"target_explanation" text,
	"principal_notes" text,
	"status" text DEFAULT 'مسودة' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"progress" integer DEFAULT 0 NOT NULL,
	"execution_status" text DEFAULT 'لم يبدأ' NOT NULL,
	"last_review_at" timestamp with time zone,
	"import_batch_id" uuid,
	"stage_targets" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "committee_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"committee_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"position" text,
	"role" text DEFAULT 'عضو' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "committee_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name_ar" text NOT NULL,
	"kind" text NOT NULL,
	"goal" text,
	"duties" jsonb,
	"seats" jsonb,
	"recurrence" text DEFAULT 'none' NOT NULL,
	"recurrence_note" text,
	"linked_to_key" text,
	"meeting_rules" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "committee_templates_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "committees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid,
	"plan_year_id" uuid NOT NULL,
	"name_ar" text NOT NULL,
	"kind" text NOT NULL,
	"goal" text,
	"duties" jsonb,
	"recurrence" text DEFAULT 'none' NOT NULL,
	"objectives" text,
	"outputs" text,
	"status" text DEFAULT 'مسودة' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"formation_doc_id" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"outcome_type" text NOT NULL,
	"text" text NOT NULL,
	"task_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"committee_id" uuid NOT NULL,
	"seq" integer DEFAULT 1 NOT NULL,
	"title" text,
	"meeting_date" timestamp with time zone,
	"location" text,
	"agenda" jsonb,
	"discussion" text,
	"status" text DEFAULT 'مسودة' NOT NULL,
	"minutes_doc_id" uuid,
	"signed_minutes_file_id" uuid,
	"completed_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "improvement_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"session_id" uuid,
	"title" text NOT NULL,
	"goals" text,
	"actions" text,
	"duration" text,
	"status" text DEFAULT 'مسودة' NOT NULL,
	"suggested" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "perf_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"cycle_type" text NOT NULL,
	"year_key" text NOT NULL,
	"model_id" uuid NOT NULL,
	"calendar_snapshot" jsonb,
	"model_snapshot" jsonb NOT NULL,
	"start_date" text,
	"end_date" text,
	"planning_deadline" text,
	"mid_deadline" text,
	"final_deadline" text,
	"followup_target" integer DEFAULT 5 NOT NULL,
	"status" text DEFAULT 'نشطة' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "perf_indicators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"key" text,
	"name_ar" text NOT NULL,
	"weight" numeric NOT NULL,
	"requires_evidence" boolean DEFAULT true NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "perf_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name_ar" text NOT NULL,
	"audience" text NOT NULL,
	"official" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'مسودة' NOT NULL,
	"description" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "perf_models_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "perf_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"indicator_id" uuid NOT NULL,
	"rating" integer,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "perf_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"session_type" text NOT NULL,
	"session_date" text,
	"status" text DEFAULT 'مسودة' NOT NULL,
	"notes" text,
	"strengths" text,
	"improvement_areas" text,
	"actions_text" text,
	"next_followup_date" text,
	"session_result" numeric,
	"coverage" numeric,
	"report_doc_id" uuid,
	"signed_report_file_id" uuid,
	"locked_at" timestamp with time zone,
	"locked_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"warning_flags" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"event" text NOT NULL,
	"detail" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"category" text,
	"room_id" uuid,
	"important" boolean DEFAULT false NOT NULL,
	"serial_number" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"condition" text DEFAULT 'جيدة' NOT NULL,
	"notes" text,
	"import_batch_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "floor_backgrounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"floor_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"transform" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floor_geometry_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"floor_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"geometry" jsonb NOT NULL,
	"status" text DEFAULT 'مسودة' NOT NULL,
	"note" text,
	"created_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name_ar" text NOT NULL,
	"level" integer NOT NULL,
	"zone_key" text DEFAULT 'boys' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "floors_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "inspection_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"room_type" text,
	"recurrence" text NOT NULL,
	"next_due" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_ar" text NOT NULL,
	"room_type" text,
	"items" jsonb NOT NULL,
	"status" text DEFAULT 'مسودة' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_op_id" text,
	"room_id" uuid NOT NULL,
	"template_id" uuid,
	"inspection_date" timestamp with time zone DEFAULT now() NOT NULL,
	"results" jsonb,
	"photos" jsonb,
	"status" text DEFAULT 'مكتمل' NOT NULL,
	"scheduled" boolean DEFAULT false NOT NULL,
	"inspector_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inspections_client_op_id_unique" UNIQUE("client_op_id")
);
--> statement-breakpoint
CREATE TABLE "maintenance_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_op_id" text,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"room_id" uuid,
	"asset_id" uuid,
	"priority" text DEFAULT 'متوسطة' NOT NULL,
	"status" text DEFAULT 'مفتوح' NOT NULL,
	"photos" jsonb,
	"owner_person_id" uuid,
	"repair_note" text,
	"closed_at" timestamp with time zone,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"reported_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_issues_client_op_id_unique" UNIQUE("client_op_id"),
	CONSTRAINT "maintenance_issues_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "readiness_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"override_value" integer NOT NULL,
	"reason" text NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"floor_id" uuid NOT NULL,
	"geom_key" text NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"room_type" text NOT NULL,
	"length_m" numeric,
	"width_m" numeric,
	"area_m2" numeric,
	"perimeter_m" numeric,
	"capacity" integer,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "site_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name_ar" text NOT NULL,
	"zone_type" text NOT NULL,
	"boundary" jsonb,
	CONSTRAINT "site_zones_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_versions" ADD CONSTRAINT "record_versions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_tasks" ADD CONSTRAINT "action_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_pdf_file_id_stored_files_id_fk" FOREIGN KEY ("pdf_file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_evidence_id_evidence_items_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_source_file_id_stored_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_committed_by_users_id_fk" FOREIGN KEY ("committed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_stages" ADD CONSTRAINT "person_stages_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_stages" ADD CONSTRAINT "person_stages_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_budget_items" ADD CONSTRAINT "plan_budget_items_plan_year_id_plan_years_id_fk" FOREIGN KEY ("plan_year_id") REFERENCES "public"."plan_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_years" ADD CONSTRAINT "plan_years_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_years" ADD CONSTRAINT "plan_years_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_change_requests" ADD CONSTRAINT "program_change_requests_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_change_requests" ADD CONSTRAINT "program_change_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_change_requests" ADD CONSTRAINT "program_change_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_deliverables" ADD CONSTRAINT "program_deliverables_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_deliverables" ADD CONSTRAINT "program_deliverables_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_kpis" ADD CONSTRAINT "program_kpis_plan_year_id_plan_years_id_fk" FOREIGN KEY ("plan_year_id") REFERENCES "public"."plan_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_milestones" ADD CONSTRAINT "program_milestones_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_risks" ADD CONSTRAINT "program_risks_plan_year_id_plan_years_id_fk" FOREIGN KEY ("plan_year_id") REFERENCES "public"."plan_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_roadmap_cells" ADD CONSTRAINT "program_roadmap_cells_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_plan_year_id_plan_years_id_fk" FOREIGN KEY ("plan_year_id") REFERENCES "public"."plan_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_members" ADD CONSTRAINT "committee_members_committee_id_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."committees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_members" ADD CONSTRAINT "committee_members_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committees" ADD CONSTRAINT "committees_template_id_committee_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."committee_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committees" ADD CONSTRAINT "committees_plan_year_id_plan_years_id_fk" FOREIGN KEY ("plan_year_id") REFERENCES "public"."plan_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committees" ADD CONSTRAINT "committees_formation_doc_id_documents_id_fk" FOREIGN KEY ("formation_doc_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committees" ADD CONSTRAINT "committees_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_outcomes" ADD CONSTRAINT "meeting_outcomes_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_committee_id_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."committees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_minutes_doc_id_documents_id_fk" FOREIGN KEY ("minutes_doc_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_signed_minutes_file_id_stored_files_id_fk" FOREIGN KEY ("signed_minutes_file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_plans" ADD CONSTRAINT "improvement_plans_cycle_id_perf_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."perf_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_plans" ADD CONSTRAINT "improvement_plans_session_id_perf_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."perf_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_plans" ADD CONSTRAINT "improvement_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perf_cycles" ADD CONSTRAINT "perf_cycles_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perf_cycles" ADD CONSTRAINT "perf_cycles_model_id_perf_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."perf_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perf_cycles" ADD CONSTRAINT "perf_cycles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perf_indicators" ADD CONSTRAINT "perf_indicators_model_id_perf_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."perf_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perf_models" ADD CONSTRAINT "perf_models_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perf_models" ADD CONSTRAINT "perf_models_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perf_ratings" ADD CONSTRAINT "perf_ratings_session_id_perf_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."perf_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perf_ratings" ADD CONSTRAINT "perf_ratings_indicator_id_perf_indicators_id_fk" FOREIGN KEY ("indicator_id") REFERENCES "public"."perf_indicators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perf_sessions" ADD CONSTRAINT "perf_sessions_cycle_id_perf_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."perf_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perf_sessions" ADD CONSTRAINT "perf_sessions_report_doc_id_documents_id_fk" FOREIGN KEY ("report_doc_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perf_sessions" ADD CONSTRAINT "perf_sessions_signed_report_file_id_stored_files_id_fk" FOREIGN KEY ("signed_report_file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perf_sessions" ADD CONSTRAINT "perf_sessions_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_history" ADD CONSTRAINT "asset_history_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_history" ADD CONSTRAINT "asset_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_backgrounds" ADD CONSTRAINT "floor_backgrounds_floor_id_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."floors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_backgrounds" ADD CONSTRAINT "floor_backgrounds_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_geometry_versions" ADD CONSTRAINT "floor_geometry_versions_floor_id_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."floors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_geometry_versions" ADD CONSTRAINT "floor_geometry_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_schedules" ADD CONSTRAINT "inspection_schedules_template_id_inspection_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."inspection_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_templates" ADD CONSTRAINT "inspection_templates_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_template_id_inspection_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."inspection_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_inspector_id_users_id_fk" FOREIGN KEY ("inspector_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_issues" ADD CONSTRAINT "maintenance_issues_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_issues" ADD CONSTRAINT "maintenance_issues_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_issues" ADD CONSTRAINT "maintenance_issues_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_issues" ADD CONSTRAINT "maintenance_issues_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_overrides" ADD CONSTRAINT "readiness_overrides_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_overrides" ADD CONSTRAINT "readiness_overrides_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_floor_id_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."floors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "record_versions_unique" ON "record_versions" USING btree ("entity_type","entity_id","version");--> statement-breakpoint
CREATE INDEX "record_versions_entity_idx" ON "record_versions" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tasks_source_idx" ON "action_tasks" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "action_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "evidence_links_entity_idx" ON "evidence_links" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "evidence_links_evidence_idx" ON "evidence_links" USING btree ("evidence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_links_unique" ON "evidence_links" USING btree ("evidence_id","entity_type","entity_id","sub_key");--> statement-breakpoint
CREATE INDEX "import_rows_batch_idx" ON "import_rows" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "calendar_events_cal_idx" ON "calendar_events" USING btree ("calendar_id");--> statement-breakpoint
CREATE INDEX "people_category_idx" ON "people" USING btree ("category");--> statement-breakpoint
CREATE INDEX "people_batch_idx" ON "people" USING btree ("import_batch_id");--> statement-breakpoint
CREATE INDEX "person_stages_person_idx" ON "person_stages" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "change_requests_program_idx" ON "program_change_requests" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "deliverables_program_idx" ON "program_deliverables" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "milestones_program_idx" ON "program_milestones" USING btree ("program_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roadmap_unique" ON "program_roadmap_cells" USING btree ("program_id","period_key");--> statement-breakpoint
CREATE UNIQUE INDEX "programs_year_seq_unique" ON "programs" USING btree ("plan_year_id","seq");--> statement-breakpoint
CREATE INDEX "programs_year_idx" ON "programs" USING btree ("plan_year_id");--> statement-breakpoint
CREATE INDEX "committee_members_committee_idx" ON "committee_members" USING btree ("committee_id");--> statement-breakpoint
CREATE INDEX "committees_year_idx" ON "committees" USING btree ("plan_year_id");--> statement-breakpoint
CREATE INDEX "outcomes_meeting_idx" ON "meeting_outcomes" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "meetings_committee_idx" ON "meetings" USING btree ("committee_id");--> statement-breakpoint
CREATE INDEX "improvement_cycle_idx" ON "improvement_plans" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "cycles_person_idx" ON "perf_cycles" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cycles_person_year_unique" ON "perf_cycles" USING btree ("person_id","year_key");--> statement-breakpoint
CREATE INDEX "indicators_model_idx" ON "perf_indicators" USING btree ("model_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ratings_session_indicator_unique" ON "perf_ratings" USING btree ("session_id","indicator_id");--> statement-breakpoint
CREATE INDEX "sessions_cycle_idx" ON "perf_sessions" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "asset_history_asset_idx" ON "asset_history" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "assets_room_idx" ON "assets" USING btree ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "geometry_floor_version_unique" ON "floor_geometry_versions" USING btree ("floor_id","version");--> statement-breakpoint
CREATE INDEX "inspections_room_idx" ON "inspections" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "maintenance_room_idx" ON "maintenance_issues" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "maintenance_status_idx" ON "maintenance_issues" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_floor_geomkey_unique" ON "rooms" USING btree ("floor_id","geom_key");
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_bd_id" uuid NOT NULL,
	"action" text NOT NULL,
	"person_id" uuid,
	"target_bd_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "duplicate_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_a_id" uuid NOT NULL,
	"person_b_id" uuid NOT NULL,
	"reason" text DEFAULT 'name_company' NOT NULL,
	"match_key" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_by_bd_id" uuid,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "duplicate_candidate_pair_unique" UNIQUE("person_a_id","person_b_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merge_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"survivor_id" uuid NOT NULL,
	"merged_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"actor_bd_id" uuid,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"undone_at" timestamp,
	"undone_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "migration_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"mode" text NOT NULL,
	"input_hash" text NOT NULL,
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approved_by_bd_id" uuid,
	"approved_at" timestamp,
	"executed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_key" text,
	"first_name" text,
	"last_name" text,
	"email" text,
	"email_normalized" text,
	"email_status" text DEFAULT 'none' NOT NULL,
	"email_confidence" integer,
	"email_source" text,
	"company" text,
	"company_key" text,
	"company_category" text,
	"job_title" text,
	"role_group" text,
	"seniority" text,
	"industry" text,
	"city" text,
	"region" text,
	"country" text,
	"owner_bd_id" uuid,
	"status" text DEFAULT 'new' NOT NULL,
	"status_activity_id" uuid,
	"source_key" text,
	"merged_into_id" uuid,
	"migration_run_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by_bd_id" uuid,
	CONSTRAINT "person_profile_key_unique" UNIQUE("profile_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "person_bd_connection" (
	"person_id" uuid NOT NULL,
	"bd_id" uuid NOT NULL,
	"connected_on" text,
	"legacy_contact_id" uuid,
	"message_count" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"received_count" integer DEFAULT 0 NOT NULL,
	"first_message_at" timestamp,
	"last_message_at" timestamp,
	"initiated_by_me" boolean,
	"reciprocal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "person_bd_connection_person_id_bd_id_pk" PRIMARY KEY("person_id","bd_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "person_id_map" (
	"legacy_table" text NOT NULL,
	"legacy_id" uuid NOT NULL,
	"person_id" uuid,
	"method" text NOT NULL,
	"migration_run_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "person_id_map_legacy_table_legacy_id_pk" PRIMARY KEY("legacy_table","legacy_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "person_property_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"property" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_by_bd_id" uuid,
	"source" text NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saved_view" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_bd_id" uuid NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "person_id" uuid;--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "actor_bd_id" uuid;--> statement-breakpoint
ALTER TABLE "bd" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'bd' NOT NULL;--> statement-breakpoint
ALTER TABLE "linkedin_scrape_job" ADD COLUMN IF NOT EXISTS "person_id" uuid;--> statement-breakpoint
ALTER TABLE "linkedin_scrape_job" ADD COLUMN IF NOT EXISTS "actor_bd_id" uuid;--> statement-breakpoint
ALTER TABLE "signal" ADD COLUMN IF NOT EXISTS "person_id" uuid;--> statement-breakpoint
ALTER TABLE "signal" ADD COLUMN IF NOT EXISTS "actor_bd_id" uuid;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "person_id" uuid;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "actor_bd_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_bd_id_bd_id_fk" FOREIGN KEY ("actor_bd_id") REFERENCES "public"."bd"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_target_bd_id_bd_id_fk" FOREIGN KEY ("target_bd_id") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "duplicate_candidate" ADD CONSTRAINT "duplicate_candidate_person_a_id_person_id_fk" FOREIGN KEY ("person_a_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "duplicate_candidate" ADD CONSTRAINT "duplicate_candidate_person_b_id_person_id_fk" FOREIGN KEY ("person_b_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "duplicate_candidate" ADD CONSTRAINT "duplicate_candidate_decided_by_bd_id_bd_id_fk" FOREIGN KEY ("decided_by_bd_id") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merge_event" ADD CONSTRAINT "merge_event_survivor_id_person_id_fk" FOREIGN KEY ("survivor_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merge_event" ADD CONSTRAINT "merge_event_merged_id_person_id_fk" FOREIGN KEY ("merged_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merge_event" ADD CONSTRAINT "merge_event_actor_bd_id_bd_id_fk" FOREIGN KEY ("actor_bd_id") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merge_event" ADD CONSTRAINT "merge_event_undone_by_bd_id_fk" FOREIGN KEY ("undone_by") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "migration_run" ADD CONSTRAINT "migration_run_approved_by_bd_id_bd_id_fk" FOREIGN KEY ("approved_by_bd_id") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "person" ADD CONSTRAINT "person_owner_bd_id_bd_id_fk" FOREIGN KEY ("owner_bd_id") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "person" ADD CONSTRAINT "person_updated_by_bd_id_bd_id_fk" FOREIGN KEY ("updated_by_bd_id") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "person_bd_connection" ADD CONSTRAINT "person_bd_connection_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "person_bd_connection" ADD CONSTRAINT "person_bd_connection_bd_id_bd_id_fk" FOREIGN KEY ("bd_id") REFERENCES "public"."bd"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "person_id_map" ADD CONSTRAINT "person_id_map_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "person_property_history" ADD CONSTRAINT "person_property_history_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "person_property_history" ADD CONSTRAINT "person_property_history_changed_by_bd_id_bd_id_fk" FOREIGN KEY ("changed_by_bd_id") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_owner_bd_id_bd_id_fk" FOREIGN KEY ("owner_bd_id") REFERENCES "public"."bd"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_actor_idx" ON "audit_log" USING btree ("actor_bd_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_person_idx" ON "audit_log" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "duplicate_candidate_status_idx" ON "duplicate_candidate" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merge_event_survivor_idx" ON "merge_event" USING btree ("survivor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merge_event_merged_idx" ON "merge_event" USING btree ("merged_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "migration_run_kind_idx" ON "migration_run" USING btree ("kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_owner_idx" ON "person" USING btree ("owner_bd_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_status_idx" ON "person" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_company_key_idx" ON "person" USING btree ("company_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_email_normalized_idx" ON "person" USING btree ("email_normalized");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_name_company_idx" ON "person" USING btree ("last_name","first_name","company_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_merged_into_idx" ON "person" USING btree ("merged_into_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_bd_connection_bd_idx" ON "person_bd_connection" USING btree ("bd_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_id_map_person_idx" ON "person_id_map" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_property_history_person_idx" ON "person_property_history" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_view_owner_idx" ON "saved_view" USING btree ("owner_bd_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity" ADD CONSTRAINT "activity_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity" ADD CONSTRAINT "activity_actor_bd_id_bd_id_fk" FOREIGN KEY ("actor_bd_id") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "linkedin_scrape_job" ADD CONSTRAINT "linkedin_scrape_job_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "linkedin_scrape_job" ADD CONSTRAINT "linkedin_scrape_job_actor_bd_id_bd_id_fk" FOREIGN KEY ("actor_bd_id") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signal" ADD CONSTRAINT "signal_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signal" ADD CONSTRAINT "signal_actor_bd_id_bd_id_fk" FOREIGN KEY ("actor_bd_id") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task" ADD CONSTRAINT "task_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task" ADD CONSTRAINT "task_actor_bd_id_bd_id_fk" FOREIGN KEY ("actor_bd_id") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_person_idx" ON "activity" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "linkedin_scrape_job_person_idx" ON "linkedin_scrape_job" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signal_person_idx" ON "signal" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_person_idx" ON "task" USING btree ("person_id");--> statement-breakpoint
-- The owner is seeded as the first admin (design D5, R5). Plain UPDATE, not
-- a conditional block: safe to run more than once (a no-op once the row is
-- already 'admin').
UPDATE "bd" SET "role" = 'admin' WHERE "email" = 'cristian@avalith.net';
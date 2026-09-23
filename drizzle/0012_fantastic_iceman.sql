CREATE TABLE IF NOT EXISTS "activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid,
	"company_key" text,
	"contact_id" uuid,
	"contact_owner_bd_id" uuid,
	"type" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company" (
	"company_key" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"relationship_stage" text,
	"revenue_potential" integer,
	"notes" text,
	"created_by_bd_id" uuid,
	"updated_by_bd_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_account" (
	"bd_id" uuid PRIMARY KEY NOT NULL,
	"email_address" text NOT NULL,
	"refresh_token_encrypted" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_error_message" text,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"disconnected_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "linkedin_scrape_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid,
	"apify_run_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"profiles_scraped" integer DEFAULT 0,
	"error_message" text,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "signal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid,
	"company_key" text,
	"contact_id" uuid,
	"source" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid,
	"company_key" text,
	"contact_id" uuid,
	"assigned_to_bd_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"due_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "email_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "email_confidence" integer;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "email_source" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity" ADD CONSTRAINT "activity_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity" ADD CONSTRAINT "activity_company_key_company_company_key_fk" FOREIGN KEY ("company_key") REFERENCES "public"."company"("company_key") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_account" ADD CONSTRAINT "email_account_bd_id_bd_id_fk" FOREIGN KEY ("bd_id") REFERENCES "public"."bd"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signal" ADD CONSTRAINT "signal_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signal" ADD CONSTRAINT "signal_company_key_company_company_key_fk" FOREIGN KEY ("company_key") REFERENCES "public"."company"("company_key") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task" ADD CONSTRAINT "task_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task" ADD CONSTRAINT "task_company_key_company_company_key_fk" FOREIGN KEY ("company_key") REFERENCES "public"."company"("company_key") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task" ADD CONSTRAINT "task_assigned_to_bd_id_bd_id_fk" FOREIGN KEY ("assigned_to_bd_id") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_lead_idx" ON "activity" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_company_idx" ON "activity" USING btree ("company_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_contact_idx" ON "activity" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_type_idx" ON "activity" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_created_idx" ON "activity" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_account_status_idx" ON "email_account" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "linkedin_scrape_job_contact_idx" ON "linkedin_scrape_job" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "linkedin_scrape_job_apify_run_idx" ON "linkedin_scrape_job" USING btree ("apify_run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "linkedin_scrape_job_status_idx" ON "linkedin_scrape_job" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signal_lead_idx" ON "signal" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signal_company_idx" ON "signal" USING btree ("company_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signal_contact_idx" ON "signal" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signal_source_idx" ON "signal" USING btree ("source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_lead_idx" ON "task" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_company_idx" ON "task" USING btree ("company_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_contact_idx" ON "task" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_assignee_idx" ON "task" USING btree ("assigned_to_bd_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_status_idx" ON "task" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_due_idx" ON "task" USING btree ("due_at");
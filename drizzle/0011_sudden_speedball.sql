CREATE TABLE IF NOT EXISTS "lead" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_key" text NOT NULL,
	"attendee_id" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"job_title" text,
	"seniority" text,
	"company_raw" text,
	"company_display" text,
	"company_group" text,
	"company_key" text,
	"industry_raw" text,
	"industry_group" text,
	"city" text,
	"region" text,
	"country" text,
	"attendee_type" text,
	"email" text,
	"email_status" text DEFAULT 'none' NOT NULL,
	"email_confidence" integer,
	"email_source" text,
	"owner_bd_id" uuid,
	"status" text DEFAULT 'new' NOT NULL,
	"notes" text,
	"updated_by_bd_id" uuid,
	"updated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_imported_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lead_source_attendee_unique" UNIQUE("source_key","attendee_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_source" (
	"key" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"imported_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead" ADD CONSTRAINT "lead_source_key_lead_source_key_fk" FOREIGN KEY ("source_key") REFERENCES "public"."lead_source"("key") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead" ADD CONSTRAINT "lead_owner_bd_id_bd_id_fk" FOREIGN KEY ("owner_bd_id") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead" ADD CONSTRAINT "lead_updated_by_bd_id_bd_id_fk" FOREIGN KEY ("updated_by_bd_id") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_owner_idx" ON "lead" USING btree ("owner_bd_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_status_idx" ON "lead" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_company_group_idx" ON "lead" USING btree ("company_group");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_industry_group_idx" ON "lead" USING btree ("industry_group");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_email_status_idx" ON "lead" USING btree ("email_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_seniority_idx" ON "lead" USING btree ("seniority");
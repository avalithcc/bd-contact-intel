-- email-attachments-recipients: files on composed emails, several "Para" recipients and "Cc" colleagues.
-- ADDITIVE ONLY: one new table and two new columns with empty defaults; nothing existing changes. Every statement is
-- guarded, so a rerun is a no-op. The files live in the private Storage bucket `email-attachments`
-- (scripts/sql/email-attachments-bucket.sql); this table is only their bookkeeping.
-- Rollback: 0053_email_attachments_recipients_rollback.sql (deploy the code that no longer declares them first).
CREATE TABLE IF NOT EXISTS "email_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bd_id" uuid NOT NULL,
	"owner_auth_uid" text NOT NULL,
	"storage_path" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"scheduled_email_id" uuid,
	"position" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "email_attachment_storage_path_unique" UNIQUE("storage_path")
);
--> statement-breakpoint
ALTER TABLE "scheduled_email" ADD COLUMN IF NOT EXISTS "recipient_person_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_email" ADD COLUMN IF NOT EXISTS "cc_addresses" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_attachment" ADD CONSTRAINT "email_attachment_bd_id_bd_id_fk" FOREIGN KEY ("bd_id") REFERENCES "public"."bd"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_attachment" ADD CONSTRAINT "email_attachment_scheduled_email_id_scheduled_email_id_fk" FOREIGN KEY ("scheduled_email_id") REFERENCES "public"."scheduled_email"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_attachment_scheduled_idx" ON "email_attachment" USING btree ("scheduled_email_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_attachment_live_idx" ON "email_attachment" USING btree ("created_at") WHERE "email_attachment"."removed_at" is null;--> statement-breakpoint
-- Close the anon/authenticated PostgREST gap on the new table (same rule as drizzle/0019_enable_rls.sql).
-- Revert: ALTER TABLE public.email_attachment DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."email_attachment" ENABLE ROW LEVEL SECURITY;

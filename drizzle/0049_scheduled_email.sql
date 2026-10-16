-- scheduled-send: a 1:1 email composed now and sent later by a pg_cron-driven dispatcher.
-- ADDITIVE ONLY: one new table, nothing existing is altered. Every statement is guarded, so a rerun is a no-op.
-- status: scheduled | sending | sent | on_hold | failed | cancelled. The partial index serves the dispatcher's due scan.
-- Rollback: 0049_scheduled_email_rollback.sql (deploy the code that no longer declares the table first).
CREATE TABLE IF NOT EXISTS "scheduled_email" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bd_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"to_address" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"reply_thread_id" text,
	"send_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"error" text,
	"gmail_message_id" text,
	"reply_baseline_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduled_email" ADD CONSTRAINT "scheduled_email_bd_id_bd_id_fk" FOREIGN KEY ("bd_id") REFERENCES "public"."bd"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduled_email" ADD CONSTRAINT "scheduled_email_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_email_due_idx" ON "scheduled_email" USING btree ("send_at") WHERE "scheduled_email"."status" = 'scheduled';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_email_bd_status_idx" ON "scheduled_email" USING btree ("bd_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_email_person_idx" ON "scheduled_email" USING btree ("person_id");
--> statement-breakpoint
-- Close the anon/authenticated PostgREST gap on the new table (same rule as drizzle/0019_enable_rls.sql).
-- Revert: ALTER TABLE public.scheduled_email DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."scheduled_email" ENABLE ROW LEVEL SECURITY;

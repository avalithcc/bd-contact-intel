-- gmail-reminder-email: a "connect your Gmail" reminder for BDs who stopped opening the CRM.
-- ADDITIVE ONLY: one nullable column on "bd" and one new table.
--
-- bd.last_seen_at: written by getCurrentBd (throttled). The backfill sets every BD that exists NOW to now(), so the
-- 2-day inactivity clock starts at deploy and nobody who is active gets a reminder on day one. BDs created later stay NULL
-- and the planner uses coalesce(last_seen_at, created_at). The backfill runs ONLY when the column is first added, so a
-- rerun never overwrites a real value or turns a new BD's NULL into now().
-- gmail_reminder_send: one row per reminder, UNIQUE (bd_id, sent_on) is the claim-before-send idempotency key.
-- Rollback: 0048_gmail_reminder_rollback.sql (deploy the code that no longer declares them first).
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bd' AND column_name = 'last_seen_at') THEN
  ALTER TABLE "bd" ADD COLUMN "last_seen_at" timestamp with time zone;
  UPDATE "bd" SET "last_seen_at" = now();
 END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gmail_reminder_send" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bd_id" uuid NOT NULL,
	"sent_on" date NOT NULL,
	"reminder_number" smallint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gmail_reminder_send_bd_day_unique" UNIQUE("bd_id","sent_on")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gmail_reminder_send" ADD CONSTRAINT "gmail_reminder_send_bd_id_bd_id_fk" FOREIGN KEY ("bd_id") REFERENCES "public"."bd"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gmail_reminder_send_bd_idx" ON "gmail_reminder_send" USING btree ("bd_id");
--> statement-breakpoint
-- Close the anon/authenticated PostgREST gap on the new table (same rule as drizzle/0019_enable_rls.sql).
-- Revert: ALTER TABLE public.gmail_reminder_send DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."gmail_reminder_send" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "task_digest_send" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bd_id" uuid NOT NULL,
	"send_date" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"subject" text,
	"today_count" integer DEFAULT 0 NOT NULL,
	"overdue_count" integer DEFAULT 0 NOT NULL,
	"yesterday_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "task_digest_send_bd_date_unique" UNIQUE("bd_id","send_date")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_digest_send" ADD CONSTRAINT "task_digest_send_bd_id_bd_id_fk" FOREIGN KEY ("bd_id") REFERENCES "public"."bd"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_digest_send_bd_idx" ON "task_digest_send" USING btree ("bd_id");
--> statement-breakpoint
-- Close the anon/authenticated PostgREST gap on this new table (same rule as
-- drizzle/0019_enable_rls.sql — the app connects as `postgres`, which owns
-- this table and has BYPASSRLS, so this is invisible to the app itself).
-- Revert: ALTER TABLE public.task_digest_send DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."task_digest_send" ENABLE ROW LEVEL SECURITY;
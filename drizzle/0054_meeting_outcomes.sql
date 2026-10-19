-- meeting-outcomes: future meetings (Agendada) and the outcome of a meeting (Se hizo / No se presentó / Reprogramada / Cancelada).
-- ADDITIVE ONLY: two new tables. Nothing existing changes. Every statement is guarded, so a rerun is a no-op.
-- The only data written is the BACKFILL at the end: every person-level `meeting_logged` activity becomes one `meeting` row
-- with status 'held' (so the Reuniones page lists them under "Realizadas"). The activity rows are NOT touched and keep
-- driving the contact status and the reports exactly as before; `meeting.held_activity_id` points back at them. Rows with
-- neither an actor nor a contact owner have no BD to show them to and are skipped (they still count in the reports).
-- Rollback: 0054_meeting_outcomes_rollback.sql (deploy the code that no longer declares the tables first).
CREATE TABLE IF NOT EXISTS "meeting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"bd_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"notes" text,
	"outcome_notes" text,
	"reason" text,
	"outcome_at" timestamp with time zone,
	"outcome_by_bd_id" uuid,
	"rescheduled_to_id" uuid,
	"rescheduled_from_id" uuid,
	"held_activity_id" uuid,
	"follow_up_task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meeting_digest_send" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bd_id" uuid NOT NULL,
	"send_date" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"subject" text,
	"today_count" integer DEFAULT 0 NOT NULL,
	"older_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_digest_send_bd_date_unique" UNIQUE("bd_id","send_date")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meeting" ADD CONSTRAINT "meeting_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meeting" ADD CONSTRAINT "meeting_bd_id_bd_id_fk" FOREIGN KEY ("bd_id") REFERENCES "public"."bd"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meeting" ADD CONSTRAINT "meeting_outcome_by_bd_id_bd_id_fk" FOREIGN KEY ("outcome_by_bd_id") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meeting" ADD CONSTRAINT "meeting_rescheduled_to_id_meeting_id_fk" FOREIGN KEY ("rescheduled_to_id") REFERENCES "public"."meeting"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meeting" ADD CONSTRAINT "meeting_rescheduled_from_id_meeting_id_fk" FOREIGN KEY ("rescheduled_from_id") REFERENCES "public"."meeting"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meeting" ADD CONSTRAINT "meeting_held_activity_id_activity_id_fk" FOREIGN KEY ("held_activity_id") REFERENCES "public"."activity"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meeting" ADD CONSTRAINT "meeting_follow_up_task_id_task_id_fk" FOREIGN KEY ("follow_up_task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meeting_digest_send" ADD CONSTRAINT "meeting_digest_send_bd_id_bd_id_fk" FOREIGN KEY ("bd_id") REFERENCES "public"."bd"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meeting_bd_status_at_idx" ON "meeting" USING btree ("bd_id","status","scheduled_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meeting_status_at_idx" ON "meeting" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meeting_person_idx" ON "meeting" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_held_activity_idx" ON "meeting" USING btree ("held_activity_id") WHERE "meeting"."held_activity_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meeting_digest_send_bd_idx" ON "meeting_digest_send" USING btree ("bd_id");--> statement-breakpoint
INSERT INTO "meeting" ("person_id", "bd_id", "scheduled_at", "status", "notes", "outcome_at", "outcome_by_bd_id", "held_activity_id", "created_at", "updated_at")
SELECT a."person_id",
       coalesce(a."actor_bd_id", p."owner_bd_id"),
       CASE WHEN a."metadata"->>'at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(Z|[+-][0-9]{2}:?[0-9]{2})$' THEN (a."metadata"->>'at')::timestamptz ELSE a."created_at" END,
       'held',
       nullif(a."metadata"->>'notes', ''),
       a."created_at",
       a."actor_bd_id",
       a."id",
       a."created_at",
       a."created_at"
FROM "activity" a
JOIN "person" p ON p."id" = a."person_id"
WHERE a."type" = 'meeting_logged'
  AND a."deleted_at" IS NULL
  AND coalesce(a."actor_bd_id", p."owner_bd_id") IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "meeting" m WHERE m."held_activity_id" = a."id");--> statement-breakpoint
-- Close the anon/authenticated PostgREST gap on the new tables (same rule as drizzle/0019_enable_rls.sql).
-- Revert: ALTER TABLE public.meeting DISABLE ROW LEVEL SECURITY; ALTER TABLE public.meeting_digest_send DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."meeting" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."meeting_digest_send" ENABLE ROW LEVEL SECURITY;

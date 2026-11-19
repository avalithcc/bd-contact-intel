-- auto-prospecting: signals that are worked once, and the drafts/refusals they produce. NOTHING here sends.
-- ADDITIVE ONLY, NO DATA WRITTEN: one table, one nullable column on `signal`, one boolean on `bd` that reads FALSE for every BD
-- (the consumer drafts for nobody until a BD is switched on by hand: UPDATE bd SET auto_prospecting_enabled = true WHERE email = '...').
-- The unique index on (data->>'postingId') where source = 'hiring' is what makes the producer idempotent: signal has 0 rows today.
-- Deploy order: apply this BEFORE the code; old code never references the new objects. Rerun-safe (IF NOT EXISTS / duplicate_object).
-- Rollback: 0070_auto_prospecting_rollback.sql.
CREATE TABLE IF NOT EXISTS "prospect_draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid NOT NULL,
	"bd_id" uuid,
	"person_id" uuid,
	"outcome" text NOT NULL,
	"reason" text,
	"subject" text,
	"body" text,
	"language" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospect_draft_signal_id_unique" UNIQUE("signal_id")
);
--> statement-breakpoint
ALTER TABLE "bd" ADD COLUMN IF NOT EXISTS "auto_prospecting_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "signal" ADD COLUMN IF NOT EXISTS "consumed_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prospect_draft" ADD CONSTRAINT "prospect_draft_signal_id_signal_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signal"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prospect_draft" ADD CONSTRAINT "prospect_draft_bd_id_bd_id_fk" FOREIGN KEY ("bd_id") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prospect_draft" ADD CONSTRAINT "prospect_draft_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospect_draft_bd_created_idx" ON "prospect_draft" USING btree ("bd_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospect_draft_person_idx" ON "prospect_draft" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "signal_hiring_posting_unique" ON "signal" USING btree (("data"->>'postingId')) WHERE "signal"."source" = 'hiring';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signal_hiring_unconsumed_idx" ON "signal" USING btree ("created_at") WHERE "signal"."source" = 'hiring' and "signal"."consumed_at" is null;
--> statement-breakpoint
ALTER TABLE "public"."prospect_draft" ENABLE ROW LEVEL SECURITY;

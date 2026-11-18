-- tenders: public tenders from COMPR.AR, tracked from "worth a look" to "we bid / we pass". Company-wide (no owner column).
-- ADDITIVE ONLY: one new empty table and two indexes. NO DATA IS WRITTEN HERE and no existing table is touched.
-- process_number is the natural key (UNIQUE): re-importing the portal's Excel updates in place instead of duplicating.
-- triage_status is validated by the app (src/lib/tenders/triage.ts), no CHECK, same convention as sequence_draft.language.
-- Deploy order: apply this BEFORE the code that reads the table; old code never references it.
-- Rerun-safe: IF NOT EXISTS makes a second run a no-op.
-- Rollback: 0066_tender_rollback.sql (deploy the code that no longer declares the table first).
CREATE TABLE IF NOT EXISTS "tender" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"process_number" text NOT NULL,
	"file_number" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"process_type" text DEFAULT '' NOT NULL,
	"opening_at" timestamp with time zone NOT NULL,
	"portal_status" text DEFAULT '' NOT NULL,
	"executing_unit" text DEFAULT '' NOT NULL,
	"financial_admin_service" text DEFAULT '' NOT NULL,
	"triage_status" text DEFAULT 'a_revisar' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tender_process_number_unique" ON "tender" USING btree ("process_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tender_opening_at_idx" ON "tender" USING btree ("opening_at");--> statement-breakpoint
-- Row Level Security: the anon key ships in the browser bundle, so a public table without RLS is readable through PostgREST.
-- The app connects as the table owner (BYPASSRLS) and is unaffected. Enforced by tests/unit/migrationsEnableRls.test.ts.
ALTER TABLE "public"."tender" ENABLE ROW LEVEL SECURITY;

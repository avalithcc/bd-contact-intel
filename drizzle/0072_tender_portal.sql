-- tender_portal: what COMPR.AR's public citizen view says about a tender (dates, guarantees, duration), so the ficha shows it
-- without anyone downloading the pliego. ADDITIVE ONLY: a new empty table, no backfill, nothing existing is touched.
-- A missing row = "never fetched"; a NULL column = "fetched, the portal does not state it".
-- Deploy order: apply this BEFORE the code that reads it; old code never references the table.
-- Rerun-safe: IF NOT EXISTS / duplicate_object guards make a second run a no-op.
-- Rollback: 0072_tender_portal_rollback.sql
CREATE TABLE IF NOT EXISTS "tender_portal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tender_id" uuid NOT NULL,
	"objeto" text,
	"currency" text,
	"contract_duration" text,
	"offer_validity" text,
	"accepts_extension" boolean,
	"questions_until" timestamp with time zone,
	"opening_at" timestamp with time zone,
	"guarantee_offer" text,
	"guarantee_contract" text,
	"guarantee_challenge" text,
	"circular_count" integer,
	"portal_url" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fetch_error" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tender_portal" ADD CONSTRAINT "tender_portal_tender_id_tender_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tender"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tender_portal_tender_unique" ON "tender_portal" USING btree ("tender_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tender_portal_fetched_at_idx" ON "tender_portal" USING btree ("fetched_at");--> statement-breakpoint
-- Row Level Security: the anon key ships in the browser bundle. The app connects as the table owner (BYPASSRLS) and is
-- unaffected. Enforced by tests/unit/migrationsEnableRls.test.ts.
ALTER TABLE "public"."tender_portal" ENABLE ROW LEVEL SECURITY;

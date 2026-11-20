-- tender_requirement_status: per-requirement answer ('have' / 'missing') of the tender must-list, keyed by the stable
-- requirement key, never by the model's text. ADDITIVE ONLY: a new empty table, no backfill. A missing row = 'pending'.
-- Deploy order: apply this BEFORE the code that reads it; old code never references the table.
-- Rollback: 0073_tender_requirement_status_rollback.sql
CREATE TABLE IF NOT EXISTS "tender_requirement_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tender_id" uuid NOT NULL,
	"requirement_key" text NOT NULL,
	"status" text NOT NULL,
	"set_by_bd_id" uuid,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tender_requirement_status" ADD CONSTRAINT "tender_requirement_status_tender_id_tender_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tender"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tender_requirement_status" ADD CONSTRAINT "tender_requirement_status_set_by_bd_id_bd_id_fk" FOREIGN KEY ("set_by_bd_id") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tender_requirement_status_tender_key_unique" ON "tender_requirement_status" USING btree ("tender_id","requirement_key");--> statement-breakpoint
-- Row Level Security: the anon key ships in the browser bundle. The app connects as the table owner (BYPASSRLS) and is
-- unaffected. Enforced by tests/unit/migrationsEnableRls.test.ts.
ALTER TABLE "public"."tender_requirement_status" ENABLE ROW LEVEL SECURITY;

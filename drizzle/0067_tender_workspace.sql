-- tender workspace: the progress log and the uploaded pliegos of a tender.
-- ADDITIVE ONLY: two new empty tables and three indexes. NO DATA IS WRITTEN HERE and no existing table is touched.
-- tender_document.analysis lives on the document it read, so a new upload never inherits an old analysis.
-- Deploy order: apply this BEFORE the code that reads the tables; old code never references them.
-- Rerun-safe: IF NOT EXISTS and the duplicate_object guards make a second run a no-op.
-- Rollback: 0067_tender_workspace_rollback.sql (deploy the code that no longer declares the tables first).
CREATE TABLE IF NOT EXISTS "tender_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tender_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"filename" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by_bd_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"analysis" jsonb,
	"analyzed_at" timestamp with time zone,
	"analyzed_by_bd_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tender_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tender_id" uuid NOT NULL,
	"actor_bd_id" uuid,
	"kind" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tender_document" ADD CONSTRAINT "tender_document_tender_id_tender_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tender"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tender_document" ADD CONSTRAINT "tender_document_uploaded_by_bd_id_bd_id_fk" FOREIGN KEY ("uploaded_by_bd_id") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tender_document" ADD CONSTRAINT "tender_document_analyzed_by_bd_id_bd_id_fk" FOREIGN KEY ("analyzed_by_bd_id") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tender_event" ADD CONSTRAINT "tender_event_tender_id_tender_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tender"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tender_event" ADD CONSTRAINT "tender_event_actor_bd_id_bd_id_fk" FOREIGN KEY ("actor_bd_id") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tender_document_tender_idx" ON "tender_document" USING btree ("tender_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tender_document_storage_path_unique" ON "tender_document" USING btree ("storage_path");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tender_event_tender_idx" ON "tender_event" USING btree ("tender_id","created_at");--> statement-breakpoint
-- Row Level Security: the anon key ships in the browser bundle. The app connects as the table owner (BYPASSRLS) and is
-- unaffected. Enforced by tests/unit/migrationsEnableRls.test.ts.
ALTER TABLE "public"."tender_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."tender_document" ENABLE ROW LEVEL SECURITY;

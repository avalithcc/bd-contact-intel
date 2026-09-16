-- Hand-written incremental migration, same rationale as 0000/0001 (see
-- those files for the full explanation): this project historically used
-- `drizzle-kit push` directly, so a freshly generated migration can emit
-- baseline DDL that silently no-ops or, worse, conflicts with existing
-- objects. All three tables here are brand new, so plain
-- `CREATE TABLE IF NOT EXISTS` is safe and idempotent.
--
-- Adds the "hiring signals" tables: target_company (companies whose public
-- job board is polled), job_posting (postings seen there), and sync_run
-- (one row per sync attempt, for observability). These are shared across
-- BDs — public job data, no BD ownership — same rationale as
-- company_category (see drizzle/0001). See src/db/schema.ts and
-- src/lib/hiring/ for the application code.
CREATE TABLE IF NOT EXISTS "target_company" (
    "company_key" text PRIMARY KEY NOT NULL,
    "display_name" text NOT NULL,
    "ats" text NOT NULL,
    "config" jsonb NOT NULL,
    "country_filter" text,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_posting" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "company_key" text NOT NULL REFERENCES "target_company"("company_key") ON DELETE CASCADE,
    "external_id" text NOT NULL,
    "title" text NOT NULL,
    "location" text NOT NULL,
    "url" text NOT NULL,
    "department" text,
    "posted_at" timestamp,
    "is_it" boolean NOT NULL,
    "first_seen" timestamp DEFAULT now() NOT NULL,
    "last_seen" timestamp DEFAULT now() NOT NULL,
    "closed_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_posting_company_external_unique" ON "job_posting" USING btree ("company_key","external_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_posting_company_closed_idx" ON "job_posting" USING btree ("company_key","closed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_posting_is_it_closed_idx" ON "job_posting" USING btree ("is_it","closed_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_run" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "company_key" text NOT NULL REFERENCES "target_company"("company_key") ON DELETE CASCADE,
    "started_at" timestamp DEFAULT now() NOT NULL,
    "finished_at" timestamp,
    "status" text NOT NULL,
    "fetched" integer DEFAULT 0 NOT NULL,
    "created" integer DEFAULT 0 NOT NULL,
    "closed" integer DEFAULT 0 NOT NULL,
    "error" text
);

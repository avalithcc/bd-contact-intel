-- Hand-written incremental migration, same rationale as 0001-0004 (see
-- those files): this project historically used `drizzle-kit push` directly
-- against the DB, so a freshly generated migration would emit baseline DDL
-- that silently no-ops rather than adding new objects. All three tables
-- here are brand new, so plain `CREATE TABLE IF NOT EXISTS` is safe and
-- idempotent.
--
-- Adds the automated ATS board discovery pipeline (see
-- src/lib/hiring/discovery.ts): `board_candidate` (a candidate ATS board
-- found for a company key seen in some BD's contacts but not yet a
-- target_company, awaiting human review), `discovery_run` (one row per
-- discovery attempt, for observability — mirrors `sync_run` but at the run
-- level), and `company_probe` (which company keys have already been probed
-- and when, so a run moves forward instead of re-guessing the same slugs
-- every time). All three are shared across BDs — public company-board
-- data, no BD ownership — same rationale as `target_company`.
CREATE TABLE IF NOT EXISTS "board_candidate" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "company_key" text NOT NULL,
    "display_name" text NOT NULL,
    "ats" text NOT NULL,
    "slug" text NOT NULL,
    "status" text DEFAULT 'pending' NOT NULL,
    "job_count" integer DEFAULT 0 NOT NULL,
    "sample_titles" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "contact_count" integer DEFAULT 0 NOT NULL,
    "discovered_at" timestamp DEFAULT now() NOT NULL,
    "decided_at" timestamp,
    "decided_by" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "board_candidate_ats_slug_unique" ON "board_candidate" USING btree ("ats","slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "board_candidate_status_idx" ON "board_candidate" USING btree ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "discovery_run" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "started_at" timestamp DEFAULT now() NOT NULL,
    "finished_at" timestamp,
    "companies_probed" integer DEFAULT 0 NOT NULL,
    "hits" integer DEFAULT 0 NOT NULL,
    "status" text NOT NULL,
    "error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_probe" (
    "company_key" text PRIMARY KEY NOT NULL,
    "last_probed_at" timestamp DEFAULT now() NOT NULL,
    "attempts" integer DEFAULT 1 NOT NULL,
    "hit" boolean DEFAULT false NOT NULL
);

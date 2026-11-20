-- tender_portal.pliego_checked_at / pliego_error: the last attempt to download the tender's pliego and why it failed, so a tender whose
-- organism has not published one is not retried on every run (it sat at the head of the queue forever). ADDITIVE ONLY: two nullable
-- columns, no backfill, no default. NULL pliego_checked_at = never tried; set with NULL pliego_error = the last attempt succeeded.
-- Deploy order: apply this BEFORE the code that reads it; old code never references the columns.
-- Rerun-safe: IF NOT EXISTS makes a second run a no-op. Columns on an existing table need no RLS change.
-- Rollback: 0074_tender_pliego_attempt_rollback.sql
ALTER TABLE "tender_portal" ADD COLUMN IF NOT EXISTS "pliego_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tender_portal" ADD COLUMN IF NOT EXISTS "pliego_error" text;

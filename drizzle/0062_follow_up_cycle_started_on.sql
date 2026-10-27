-- follow-up-expiry: the ART calendar date a contact FIRST entered the daily follow-up queue in its current cadence cycle. The expiry clock
-- (days 0-2 normal, 3-9 Vencido, 10 dropped automatically) counts from it, not from the last touch. Written by the daily materialization as
-- the row's own queue_date; a cycle owns exactly one row.
-- ADDITIVE ONLY: one NULLABLE column, no default, no backfill, no rewrite (catalog-only on Postgres 11+). NO DATA IS WRITTEN HERE.
-- NULL on every pre-existing row means "belongs to no cycle": such a row never goes overdue and is never carried to another day, so on
-- activation day nothing is Vencido and nothing is auto-dropped; every contact due under the new 5-day rule enters with cycle_started_on = that day.
-- Deploy order: apply this BEFORE deploying the code that reads the column (the follow-ups page and the sidebar badge select it on every
-- load); the old code ignores it, so applying first is safe. Rerun-safe: IF NOT EXISTS makes a second run a no-op.
-- Rollback: 0062_follow_up_cycle_started_on_rollback.sql (deploy the code that no longer declares the column first).
SET LOCAL lock_timeout = '3s';
--> statement-breakpoint
ALTER TABLE "follow_up_queue_item" ADD COLUMN IF NOT EXISTS "cycle_started_on" date;
--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;

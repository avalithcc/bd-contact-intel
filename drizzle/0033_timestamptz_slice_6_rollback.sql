-- Rollback for drizzle/0033_timestamptz_slice_6.sql.
--
-- NOT part of the drizzle journal (drizzle/meta/_journal.json) on purpose —
-- drizzle-kit migrate only applies files it finds referenced there, so this
-- file is inert until someone runs it by hand. Never add it to the journal;
-- per the migration plan's "Rollback" note, a rollback is forward-only: it
-- is applied as its own manual step, never by editing/reverting an already-
-- applied migration in place.
--
-- Required order (plan's "Rollback" section, inverted for slices 2+ — see
-- the "Required sequence" update in the migration plan):
--   1. Redeploy the previous code (schema.ts with these columns back to
--      plain `timestamp(...)`, no `withTimezone: true`) FIRST.
--   2. Only then run this file by hand against production.
-- Reversing that order re-creates the exact deploy-order hazard the plan
-- warns about ("The non-obvious risk: Drizzle's timestamp parser").
--
-- Values are unchanged by this cast: every row was written as UTC, so
-- `c AT TIME ZONE 'UTC'` on a timestamptz column converts it back to the
-- same wall-clock UTC instant as a naive timestamp.
--
-- MUST be run as ONE transaction (all-or-nothing, CLAUDE.md write rule 4)
-- so all thirteen columns revert together — never plain autocommit psql, where each
-- statement is its own implicit transaction and `SET LOCAL` would silently
-- stop applying after the first statement, leaving later ALTERs with no
-- lock_timeout guard at all. Run with `psql --single-transaction`, or via a
-- postgres.js `sql.begin(...)` block — see the runbook for the exact
-- command.
BEGIN;
SET LOCAL lock_timeout = '2s';
ALTER TABLE "person_bd_connection" ALTER COLUMN "first_message_at" SET DATA TYPE timestamp USING "first_message_at" AT TIME ZONE 'UTC';
ALTER TABLE "person_bd_connection" ALTER COLUMN "last_message_at" SET DATA TYPE timestamp USING "last_message_at" AT TIME ZONE 'UTC';
ALTER TABLE "person_bd_connection" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "email_account" ALTER COLUMN "last_synced_at" SET DATA TYPE timestamp USING "last_synced_at" AT TIME ZONE 'UTC';
ALTER TABLE "email_account" ALTER COLUMN "reconnect_banner_dismissed_at" SET DATA TYPE timestamp USING "reconnect_banner_dismissed_at" AT TIME ZONE 'UTC';
ALTER TABLE "email_account" ALTER COLUMN "connected_at" SET DATA TYPE timestamp USING "connected_at" AT TIME ZONE 'UTC';
ALTER TABLE "email_account" ALTER COLUMN "disconnected_at" SET DATA TYPE timestamp USING "disconnected_at" AT TIME ZONE 'UTC';
ALTER TABLE "email_account" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "email_message" ALTER COLUMN "sent_at" SET DATA TYPE timestamp USING "sent_at" AT TIME ZONE 'UTC';
ALTER TABLE "email_message" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "follow_up_queue_item" ALTER COLUMN "last_touch_at" SET DATA TYPE timestamp USING "last_touch_at" AT TIME ZONE 'UTC';
ALTER TABLE "follow_up_queue_item" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "follow_up_queue_item" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at" AT TIME ZONE 'UTC';
COMMIT;

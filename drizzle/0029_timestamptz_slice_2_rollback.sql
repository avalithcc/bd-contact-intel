-- Rollback for drizzle/0029_timestamptz_slice_2.sql.
--
-- NOT part of the drizzle journal (drizzle/meta/_journal.json) on purpose —
-- drizzle-kit migrate only applies files it finds referenced there, so this
-- file is inert until someone runs it by hand. Never add it to the journal;
-- per the migration plan's "Rollback" note, a rollback is forward-only: it
-- is applied as its own manual step, never by editing/reverting an already-
-- applied migration in place.
--
-- Required order (plan's "Rollback" section, now inverted for slice 2 — see
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
-- so every table reverts together — never plain autocommit psql, where each
-- statement is its own implicit transaction and `SET LOCAL` would silently
-- stop applying after the first statement, leaving later ALTERs with no
-- lock_timeout guard at all. Run with `psql --single-transaction`, or via a
-- postgres.js `sql.begin(...)` block — see the runbook for the exact
-- command.
BEGIN;
SET LOCAL lock_timeout = '2s';
ALTER TABLE "job_posting" ALTER COLUMN "posted_at" SET DATA TYPE timestamp USING "posted_at" AT TIME ZONE 'UTC';
ALTER TABLE "job_posting" ALTER COLUMN "first_seen" SET DATA TYPE timestamp USING "first_seen" AT TIME ZONE 'UTC';
ALTER TABLE "job_posting" ALTER COLUMN "last_seen" SET DATA TYPE timestamp USING "last_seen" AT TIME ZONE 'UTC';
ALTER TABLE "job_posting" ALTER COLUMN "closed_at" SET DATA TYPE timestamp USING "closed_at" AT TIME ZONE 'UTC';
ALTER TABLE "contact" ALTER COLUMN "first_message_at" SET DATA TYPE timestamp USING "first_message_at" AT TIME ZONE 'UTC';
ALTER TABLE "contact" ALTER COLUMN "last_message_at" SET DATA TYPE timestamp USING "last_message_at" AT TIME ZONE 'UTC';
ALTER TABLE "contact" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "conversation" ALTER COLUMN "first_message_at" SET DATA TYPE timestamp USING "first_message_at" AT TIME ZONE 'UTC';
ALTER TABLE "conversation" ALTER COLUMN "last_message_at" SET DATA TYPE timestamp USING "last_message_at" AT TIME ZONE 'UTC';
ALTER TABLE "conversation" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "message" ALTER COLUMN "sent_at" SET DATA TYPE timestamp USING "sent_at" AT TIME ZONE 'UTC';
ALTER TABLE "message" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at" AT TIME ZONE 'UTC';
COMMIT;

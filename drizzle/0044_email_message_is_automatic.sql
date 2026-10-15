-- outreach-sequences, PR 10: mark machine-generated mail so a Sequence never treats an out-of-office as a reply.
-- ADDITIVE ONLY, one statement: a new column with a constant default. Nothing is dropped, rewritten or backfilled.
--   * On Postgres 11+ ADD COLUMN with a constant DEFAULT is a catalog change, not a table rewrite, so it does not
--     lock email_message for a scan. IF NOT EXISTS makes a second run a no-op.
--   * Every existing row reads false, which is correct: before this migration nothing classified automatic mail.
--   * Code that does not know the column keeps working (the default fills it), so applying this BEFORE the code
--     that declares it is safe, and that is the required order (tasks.md gate 0.1): Drizzle SELECTs every column
--     schema.ts declares, so the reverse order breaks every query on email_message, the Gmail sync included.
-- Rollback: 0044_email_message_is_automatic_rollback.sql (deploy the code that no longer declares the column first).
ALTER TABLE "email_message" ADD COLUMN IF NOT EXISTS "is_automatic" boolean DEFAULT false NOT NULL;

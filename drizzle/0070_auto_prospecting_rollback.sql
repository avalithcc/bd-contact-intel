-- Rollback for drizzle/0070_auto_prospecting.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Deploy the code that no longer declares these objects FIRST.
-- Dropping loses every generated draft and refusal, and every signal's consumed_at (the signals themselves stay).
-- Remove the journal entry (idx 70), drizzle/meta/0070_snapshot.json and the drizzle.__drizzle_migrations row.
SET LOCAL lock_timeout = '3s';
DROP TABLE IF EXISTS "prospect_draft";
DROP INDEX IF EXISTS "signal_hiring_unconsumed_idx";
DROP INDEX IF EXISTS "signal_hiring_posting_unique";
ALTER TABLE "signal" DROP COLUMN IF EXISTS "consumed_at";
ALTER TABLE "bd" DROP COLUMN IF EXISTS "auto_prospecting_enabled";
SET LOCAL lock_timeout = DEFAULT;

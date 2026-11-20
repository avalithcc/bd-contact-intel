-- Rollback for drizzle/0074_tender_pliego_attempt.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Deploy the code that no longer reads these columns BEFORE
-- running it. Dropping loses only the retry bookkeeping; the next run simply retries every tender without a document.
-- Remove the journal entry (idx 74), drizzle/meta/0074_snapshot.json and the drizzle.__drizzle_migrations row.
SET LOCAL lock_timeout = '3s';
ALTER TABLE "tender_portal" DROP COLUMN IF EXISTS "pliego_error";
ALTER TABLE "tender_portal" DROP COLUMN IF EXISTS "pliego_checked_at";
SET LOCAL lock_timeout = DEFAULT;

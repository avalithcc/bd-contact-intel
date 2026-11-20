-- Rollback for drizzle/0073_tender_requirement_status.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Deploy the code that no longer reads
-- tender_requirement_status BEFORE running it. Dropping loses the answers given by administration; they are not recoverable.
-- Remove the journal entry (idx 73), drizzle/meta/0073_snapshot.json and the drizzle.__drizzle_migrations row.
SET LOCAL lock_timeout = '3s';
DROP TABLE IF EXISTS "tender_requirement_status";
SET LOCAL lock_timeout = DEFAULT;

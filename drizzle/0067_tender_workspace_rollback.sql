-- Rollback for drizzle/0067_tender_workspace.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Deploy the code that no longer declares these tables
-- BEFORE running it. Dropping loses the progress log and the record of which pliego was uploaded; the files stay in the
-- `tender-documents` bucket (empty it from the dashboard). Remove the journal entry (idx 67), drizzle/meta/0067_snapshot.json
-- and the drizzle.__drizzle_migrations row for it.
SET LOCAL lock_timeout = '3s';
DROP TABLE IF EXISTS "tender_document";
DROP TABLE IF EXISTS "tender_event";
SET LOCAL lock_timeout = DEFAULT;

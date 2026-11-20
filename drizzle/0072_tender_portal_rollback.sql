-- Rollback for drizzle/0072_tender_portal.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Deploy the code that no longer reads tender_portal
-- BEFORE running it. Dropping loses only the cached portal data; the next fetch run rebuilds it from the public portal.
-- Remove the journal entry (idx 72), drizzle/meta/0072_snapshot.json and the drizzle.__drizzle_migrations row.
SET LOCAL lock_timeout = '3s';
DROP TABLE IF EXISTS "tender_portal";
SET LOCAL lock_timeout = DEFAULT;

-- Rollback for drizzle/0066_tender.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Deploy the code that no longer declares the tender
-- table BEFORE running this (the /licitaciones page and its import read it). Dropping it loses every imported tender AND the
-- triage state and notes typed on them: the portal can be re-exported, the triage cannot. Save them first if needed:
--   SELECT process_number, triage_status, note FROM tender WHERE triage_status <> 'a_revisar' OR note IS NOT NULL;
-- Also remove the journal entry (idx 66, tag 0066_tender), drizzle/meta/0066_snapshot.json and the
-- drizzle.__drizzle_migrations row for it.
SET LOCAL lock_timeout = '3s';
DROP TABLE IF EXISTS "tender";
SET LOCAL lock_timeout = DEFAULT;

-- Rollback for drizzle/0069_tender_owner.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Deploy the code that no longer declares this column
-- BEFORE running it. Dropping loses every assignment (the 'owner' entries in tender_event keep the history).
-- Remove the journal entry (idx 69), drizzle/meta/0069_snapshot.json (if one was generated) and the drizzle.__drizzle_migrations row.
SET LOCAL lock_timeout = '3s';
ALTER TABLE "tender" DROP CONSTRAINT IF EXISTS "tender_owner_bd_id_bd_id_fk";
ALTER TABLE "tender" DROP COLUMN IF EXISTS "owner_bd_id";
SET LOCAL lock_timeout = DEFAULT;

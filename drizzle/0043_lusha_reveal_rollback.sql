-- Rollback for drizzle/0043_lusha_reveal.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. DESTROYS the whole Lusha ledger: every search,
-- reveal, price snapshot and raw payload, and with them the record of what was spent. If any row exists, copy it out
-- first (SELECT * FROM lusha_reveal;): revealed values already written to person.email / person.phone are NOT removed,
-- but their provenance and the day's spend history are. Deploy the code that no longer declares this table BEFORE
-- running this. Dropping the table drops its indexes, foreign keys and RLS flag with it.
-- Also remove the journal entry (idx 43, tag 0043_lusha_reveal) and drizzle/meta/0043_snapshot.json, and delete the
-- drizzle.__drizzle_migrations row for it, or the next migrate believes this migration is still applied.
DROP TABLE IF EXISTS "lusha_reveal";

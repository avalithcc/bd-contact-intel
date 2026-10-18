-- Rollback for drizzle/0051_person_phone_digits_suffix_idx.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Drops the two suffix indexes; phone search keeps
-- working (seq scan over ~27k rows) but loses its index. Deploy code without the suffix condition first if you want the
-- search to stay fast. Also remove the journal entry (idx 51) and drizzle/meta/0051_snapshot.json, and delete the
-- drizzle.__drizzle_migrations row for it.
DROP INDEX IF EXISTS "person_phone_digits_suffix_idx";
DROP INDEX IF EXISTS "person_mobile_phone_digits_suffix_idx";

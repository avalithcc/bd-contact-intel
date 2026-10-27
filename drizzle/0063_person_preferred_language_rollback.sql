-- Rollback for drizzle/0063_person_preferred_language.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Deploy the code that no longer declares person.preferred_language
-- BEFORE running this, or the contact record and the Sequence reads select a column that no longer exists. After it every draft language is
-- decided by the audience chain again (the pre-feature behaviour). Save the values first if needed:
--   SELECT id, preferred_language FROM person WHERE preferred_language IS NOT NULL;
-- Also remove the journal entry (idx 63, tag 0063_person_preferred_language), drizzle/meta/0063_snapshot.json and the
-- drizzle.__drizzle_migrations row for it. The person_property_history rows with property = 'preferredLanguage' are NOT removed (they are
-- history, and nothing reads them once the property is gone).
SET LOCAL lock_timeout = '3s';
ALTER TABLE "person" DROP COLUMN IF EXISTS "preferred_language";
SET LOCAL lock_timeout = DEFAULT;

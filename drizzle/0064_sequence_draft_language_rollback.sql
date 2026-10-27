-- Rollback for drizzle/0064_sequence_draft_language.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Deploy the code that no longer declares sequence_draft.language
-- BEFORE running this, or the Sequence detail read and the release read select a column that no longer exists. After it no draft is ever
-- flagged as written in another language, and a reminder is drafted in the language the resolver says at that moment again (the
-- pre-feature behaviour). Save the values first if needed:
--   SELECT id, sequence_member_id, step, language FROM sequence_draft WHERE language IS NOT NULL;
-- Also remove the journal entry (idx 64, tag 0064_sequence_draft_language), drizzle/meta/0064_snapshot.json and the
-- drizzle.__drizzle_migrations row for it.
SET LOCAL lock_timeout = '3s';
ALTER TABLE "sequence_draft" DROP COLUMN IF EXISTS "language";
SET LOCAL lock_timeout = DEFAULT;

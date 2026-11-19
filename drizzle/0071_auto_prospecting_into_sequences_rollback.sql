-- Rollback for drizzle/0071_auto_prospecting_into_sequences.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Deploy the code that no longer declares the column FIRST.
-- Loses only the link from a draft to its Sequence member; the members and their drafts stay in Sequences.
-- Remove the journal entry (idx 71), drizzle/meta/0071_snapshot.json and the drizzle.__drizzle_migrations row.
SET LOCAL lock_timeout = '3s';
DROP INDEX IF EXISTS "prospect_draft_member_idx";
ALTER TABLE "prospect_draft" DROP COLUMN IF EXISTS "sequence_member_id";
SET LOCAL lock_timeout = DEFAULT;

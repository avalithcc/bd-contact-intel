-- Rollback for drizzle/0061_sequence_member_draft_language.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Deploy the code that no longer declares
-- sequence_member.draft_language / draft_language_by_bd_id / draft_language_at BEFORE running this, or every Sequence screen selects
-- columns that no longer exist. After it, every member is back to the language its audience resolves to: it forgets who chose a
-- language and when, and drafts regenerated later may come out in a different language than the one chosen. Save the choices first:
--   SELECT id, draft_language, draft_language_by_bd_id, draft_language_at FROM sequence_member WHERE draft_language IS NOT NULL;
-- Also remove the journal entry (idx 61, tag 0061_sequence_member_draft_language), drizzle/meta/0061_snapshot.json and the
-- drizzle.__drizzle_migrations row for it.
SET LOCAL lock_timeout = '3s';
ALTER TABLE "sequence_member" DROP CONSTRAINT IF EXISTS "sequence_member_draft_language_by_bd_id_bd_id_fk";
ALTER TABLE "sequence_member" DROP COLUMN IF EXISTS "draft_language_at";
ALTER TABLE "sequence_member" DROP COLUMN IF EXISTS "draft_language_by_bd_id";
ALTER TABLE "sequence_member" DROP COLUMN IF EXISTS "draft_language";
SET LOCAL lock_timeout = DEFAULT;

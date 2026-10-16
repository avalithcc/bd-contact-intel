-- Rollback for drizzle/0045_activity_soft_delete.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Deploy the code that no longer declares
-- activity.deleted_at / activity.deleted_by_bd_id BEFORE running this, or every query on activity selects columns that no
-- longer exist. DESTRUCTIVE in one way: it forgets which notes were deleted, by whom and when, so every deleted note would
-- show again with its original text (the text itself is never removed by a deletion). Save the markers first if that matters:
--   SELECT id, deleted_at, deleted_by_bd_id FROM activity WHERE deleted_at IS NOT NULL;
-- Also remove the journal entry (idx 45, tag 0045_activity_soft_delete) and drizzle/meta/0045_snapshot.json, and delete the
-- drizzle.__drizzle_migrations row for it, or the next migrate believes this migration is still applied.
ALTER TABLE "activity" DROP CONSTRAINT IF EXISTS "activity_deleted_by_bd_id_bd_id_fk";
ALTER TABLE "activity" DROP COLUMN IF EXISTS "deleted_by_bd_id";
ALTER TABLE "activity" DROP COLUMN IF EXISTS "deleted_at";

-- Rollback for drizzle/0062_follow_up_cycle_started_on.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Deploy the code that no longer declares
-- follow_up_queue_item.cycle_started_on BEFORE running this, or the follow-ups page and the sidebar badge select a column that no longer
-- exists. After it every queue row is a plain one-day row again (the pre-feature behaviour). Save the dates first if needed:
--   SELECT id, bd_id, person_id, queue_date, cycle_started_on FROM follow_up_queue_item WHERE cycle_started_on IS NOT NULL;
-- Also remove the journal entry (idx 62, tag 0062_follow_up_cycle_started_on), drizzle/meta/0062_snapshot.json and the
-- drizzle.__drizzle_migrations row for it. The follow_up_dropped / follow_up_expired / follow_up_reentered activity rows are NOT removed
-- (they are history); an older build renders an unknown activity type as its raw name.
SET LOCAL lock_timeout = '3s';
ALTER TABLE "follow_up_queue_item" DROP COLUMN IF EXISTS "cycle_started_on";
SET LOCAL lock_timeout = DEFAULT;

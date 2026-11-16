-- Rollback for drizzle/0065_bd_follow_up_excluded_role_groups.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Deploy the code that no longer declares
-- bd.follow_up_excluded_role_groups BEFORE running this, or getCurrentBd (which selects every bd column) and the candidate query
-- reference a column that no longer exists. After it every BD's queue takes every role group again (the pre-feature behaviour).
-- Save the values first if needed:
--   SELECT id, email, follow_up_excluded_role_groups FROM bd WHERE follow_up_excluded_role_groups <> '{}';
-- Also remove the journal entry (idx 65, tag 0065_bd_follow_up_excluded_role_groups), drizzle/meta/0065_snapshot.json and the
-- drizzle.__drizzle_migrations row for it.
SET LOCAL lock_timeout = '3s';
ALTER TABLE "bd" DROP COLUMN IF EXISTS "follow_up_excluded_role_groups";
SET LOCAL lock_timeout = DEFAULT;

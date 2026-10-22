-- Rollback for drizzle/0060_bd_lusha_personal_cap.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Deploy the code that no longer declares
-- bd.lusha_personal_daily_credit_cap BEFORE running this, or every query on bd selects a column that no longer exists. After it,
-- no BD has a personal cap any more (only the monthly and daily caps apply). It forgets who had one; save that first:
--   SELECT id, email, lusha_personal_daily_credit_cap FROM bd WHERE lusha_personal_daily_credit_cap IS NOT NULL;
-- Also remove the journal entry (idx 60, tag 0060_bd_lusha_personal_cap), drizzle/meta/0060_snapshot.json and the
-- drizzle.__drizzle_migrations row for it.
SET LOCAL lock_timeout = '3s';
ALTER TABLE "bd" DROP COLUMN IF EXISTS "lusha_personal_daily_credit_cap";
SET LOCAL lock_timeout = DEFAULT;

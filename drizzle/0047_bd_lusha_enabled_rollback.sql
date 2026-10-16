-- Rollback for drizzle/0047_bd_lusha_enabled.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Deploy the code that no longer declares
-- bd.lusha_enabled BEFORE running this, or every query on bd selects a column that no longer exists. After it, every BD can
-- spend Lusha credits again (the pre-0047 behaviour). It forgets who was switched off; save that first if it matters:
--   SELECT id, email FROM bd WHERE lusha_enabled = false;
-- The audit_log rows 'bd_lusha_enable' / 'bd_lusha_disable' are left in place. Also remove the journal entry (idx 47, tag
-- 0047_bd_lusha_enabled) and drizzle/meta/0047_snapshot.json, and delete the drizzle.__drizzle_migrations row for it.
ALTER TABLE "bd" DROP COLUMN IF EXISTS "lusha_enabled";

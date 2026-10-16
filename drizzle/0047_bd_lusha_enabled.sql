-- lusha-per-bd: a per-BD switch for Lusha. Without it any BD can spend the team's shared Lusha credits.
-- ADDITIVE ONLY: one NOT NULL boolean column on "bd". A constant default is a catalog change on Postgres 11+, not a rewrite.
--
-- OWNER-DECIDED SPLIT, read before changing it:
--   * EXISTING BDs keep their current access. The column is added with DEFAULT true, which fills every row that exists now
--     with true; the default is then switched to false. Turning everyone off at deploy would silently cut off every BD who
--     uses Lusha today, a far worse surprise than an admin switching someone off on purpose.
--   * NEW BDs start DISABLED: any row inserted after this migration gets the false default. Access is granted on purpose
--     from /admin/lusha, never inherited.
-- Rerun-safe: ADD COLUMN IF NOT EXISTS skips the fill and SET DEFAULT false is idempotent, so a second run never re-enables
-- a BD an admin disabled.
-- Rollback: 0047_bd_lusha_enabled_rollback.sql (deploy the code that no longer declares the column first).
ALTER TABLE "bd" ADD COLUMN IF NOT EXISTS "lusha_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "bd" ALTER COLUMN "lusha_enabled" SET DEFAULT false;

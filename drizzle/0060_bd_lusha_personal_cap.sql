-- lusha-per-bd-cap: a third Lusha credit cap, personal to one BD and evaluated beside the two global ones (src/lib/lusha/cap.ts).
-- ADDITIVE ONLY: one NULLABLE integer column on "bd" with no default and no backfill. A nullable column without a default is a
-- catalog-only change on Postgres 11+ (no rewrite, no table scan).
--
-- NULL means "no personal cap": the BD keeps behaving exactly as before, under the monthly and daily caps only. A BD created later
-- is NULL too, so the cap is set on purpose, never inherited. 0 is a real value and means "blocked" (the kill switch), never "no cap".
-- The number is CREDITS per Argentina day, not contacts: revealing one email costs 2 (a search row plus the emails row), and the
-- search is charged even when it finds nothing. NO DATA IS WRITTEN HERE; setting a BD's value is a separate, approved step.
-- Rerun-safe: ADD COLUMN IF NOT EXISTS is a no-op the second time.
-- Rollback: 0060_bd_lusha_personal_cap_rollback.sql (deploy the code that no longer declares the column first).
SET LOCAL lock_timeout = '3s';
--> statement-breakpoint
ALTER TABLE "bd" ADD COLUMN IF NOT EXISTS "lusha_personal_daily_credit_cap" integer;
--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;

-- follow-up-role-groups: the role groups a BD does NOT want entering their daily follow-up queue, one column on "bd".
-- A deny-list on purpose: a RoleGroupKey added later enters every queue by default instead of being silently excluded.
-- Empty array = every group enters = exactly the behaviour before this migration. No backfill: nothing changes for any BD until they opt in.
-- Read by the daily selection only (src/lib/followUp/candidateQuery.ts); rows already in the queue are never evicted by it.
-- ADDITIVE ONLY: one NOT NULL column with a constant default (catalog-only on Postgres 11+, no table rewrite). NO DATA IS WRITTEN HERE.
-- Values are validated by the app at the write boundary (roleGroupPreference.ts), no CHECK, same convention as sequence_draft.language.
-- Deploy order: apply this BEFORE deploying the code that reads the column (getCurrentBd selects every bd column); old code ignores it.
-- Rerun-safe: IF NOT EXISTS makes a second run a no-op.
-- Rollback: 0065_bd_follow_up_excluded_role_groups_rollback.sql (deploy the code that no longer declares the column first).
SET LOCAL lock_timeout = '3s';
--> statement-breakpoint
ALTER TABLE "bd" ADD COLUMN IF NOT EXISTS "follow_up_excluded_role_groups" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;

-- Slice 4 of the naive-timestamp -> timestamptz migration plan
-- (openspec/decisions/2026-09-30-timestamptz-migration-plan.md). Scope:
-- company (created_at, updated_at). Every existing value is already UTC, so
-- `USING c AT TIME ZONE 'UTC'` reinterprets the naive wall-clock value as
-- that same UTC instant — no value changes, only the column's declared
-- type. `SET LOCAL lock_timeout` makes a blocked ALTER abort instead of
-- queuing and exhausting the 3-connection production pool (see the plan's
-- "Required sequence for each slice").
SET LOCAL lock_timeout = '2s';--> statement-breakpoint
ALTER TABLE "company" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "company" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';

-- This is the first migration file ever generated for this project; the
-- `bd` and `contact` tables already exist in the database (created via
-- `drizzle-kit push` during earlier development), so this migration is
-- hand-written as an incremental ALTER rather than the raw `drizzle-kit
-- generate` output (which emits `CREATE TABLE IF NOT EXISTS` baseline DDL
-- that would silently no-op on the already-existing `contact` table and
-- never add the new column).
--
-- Adds `role_group`: a deterministic classification of `contact.position`
-- into a coarse role bucket (see src/lib/roleGroups.ts), computed at
-- import/backfill time. Existing rows are NULL until the backfill script
-- (scripts/backfill-role-groups.ts) is run — see that file for instructions.
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "role_group" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_bd_role_group_idx" ON "contact" USING btree ("bd_id","role_group");

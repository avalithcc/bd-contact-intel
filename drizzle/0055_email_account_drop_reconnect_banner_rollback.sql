-- Rollback for drizzle/0055_email_account_drop_reconnect_banner.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Re-adds the unused column (nullable; no row had it
-- set when it was dropped). Also remove the journal entry (idx 55), drizzle/meta/0055_snapshot.json and the
-- drizzle.__drizzle_migrations row, and restore the column in src/db/schema.ts.
ALTER TABLE "email_account" ADD COLUMN IF NOT EXISTS "reconnect_banner_dismissed_at" timestamp with time zone;

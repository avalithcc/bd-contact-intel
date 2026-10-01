-- Rollback for drizzle/0036_email_message_rfc_ids.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand, and
-- only after the code that reads/writes these columns is no longer deployed.
-- Drops the stored RFC Message-ID / References of every synced message
-- (recoverable by re-running scripts/backfill-rfc-message-ids.ts).
ALTER TABLE "email_message" DROP COLUMN IF EXISTS "rfc_message_id";
ALTER TABLE "email_message" DROP COLUMN IF EXISTS "rfc_references";

-- Rollback for drizzle/0044_email_message_is_automatic.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Deploy the code that no longer declares
-- email_message.is_automatic BEFORE running this, or every query on email_message (the Gmail sync included) selects a
-- column that no longer exists. Loses only the automatic-mail flag; no message, activity or status depends on it, and
-- the flag can be recomputed for new mail by re-syncing. Also remove the journal entry (idx 44, tag
-- 0044_email_message_is_automatic) and drizzle/meta/0044_snapshot.json, and delete the drizzle.__drizzle_migrations
-- row for it, or the next migrate believes this migration is still applied.
ALTER TABLE "email_message" DROP COLUMN IF EXISTS "is_automatic";

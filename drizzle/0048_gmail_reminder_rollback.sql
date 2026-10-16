-- Rollback for drizzle/0048_gmail_reminder.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Deploy the code that no longer declares
-- bd.last_seen_at or gmail_reminder_send BEFORE running this, and remove the /api/gmail/reminders cron from vercel.json.
-- Forgets every reminder already sent; save them first if it matters: SELECT * FROM gmail_reminder_send;
-- Also remove the journal entry (idx 48, tag 0048_gmail_reminder) and drizzle/meta/0048_snapshot.json, and delete the
-- drizzle.__drizzle_migrations row for it.
DROP TABLE IF EXISTS "gmail_reminder_send";
ALTER TABLE "bd" DROP COLUMN IF EXISTS "last_seen_at";
ALTER TABLE "bd" DROP COLUMN IF EXISTS "email_reminders_enabled";

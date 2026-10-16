-- Rollback for drizzle/0049_scheduled_email.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Deploy the code that no longer declares
-- scheduled_email BEFORE running this, and unschedule the pg_cron job (select cron.unschedule('scheduled-email-every-minute')).
-- Forgets every pending, held and failed scheduled email; save them first if it matters: SELECT * FROM scheduled_email;
-- Also remove the journal entry (idx 49, tag 0049_scheduled_email) and drizzle/meta/0049_snapshot.json, and delete the
-- drizzle.__drizzle_migrations row for it.
DROP TABLE IF EXISTS "scheduled_email";

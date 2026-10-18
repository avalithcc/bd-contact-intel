-- Rollback for drizzle/0052_email_message_bd_sent_idx.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Safe at any time: only the newest-email lookup of the
-- admin Gmail fleet view uses the index, and without it that lookup reads every message of each BD (about 4 ms at 3,200 rows).
-- Also remove the journal entry (idx 52, tag 0052_email_message_bd_sent_idx) and drizzle/meta/0052_snapshot.json, and delete
-- the drizzle.__drizzle_migrations row for it.
DROP INDEX IF EXISTS "email_message_bd_sent_idx";

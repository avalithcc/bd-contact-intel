-- Rollback for drizzle/0057_sequence_member_release_idx.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Safe at any time: the indexes only make the release runner's
-- idle tick (every minute) read the few `approved` members and the `sent` members with a reminder date instead of scanning every
-- member; without them the same tick scans sequence_member (about 1.4 ms at 20,000 members, measured on the scratch database).
-- Also remove the journal entry (tag 0057_sequence_member_release_idx) and drizzle/meta/0057_snapshot.json, and delete the
-- drizzle.__drizzle_migrations row for it.
DROP INDEX IF EXISTS "sequence_member_approved_idx";
DROP INDEX IF EXISTS "sequence_member_reminder_due_idx";

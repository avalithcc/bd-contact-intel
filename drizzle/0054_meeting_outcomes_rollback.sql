-- Rollback for drizzle/0054_meeting_outcomes.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Deploy the code that no longer declares the two
-- tables first. This drops every scheduled meeting and every outcome (agendada, no se presentó, reprogramada, cancelada)
-- recorded since the release; the held meetings keep existing as `meeting_logged` activity, which was never changed, so the
-- contact status and the reports are unaffected. The `meeting_scheduled`, `meeting_no_show`, `meeting_cancelled` and
-- `meeting_rescheduled` activity rows stay in `activity` (unknown types are ignored by the timeline filters); delete them
-- by hand if they must go: delete from activity where type in ('meeting_scheduled','meeting_no_show','meeting_cancelled','meeting_rescheduled');
-- Also remove the journal entry (idx 54, tag 0054_meeting_outcomes) and drizzle/meta/0054_snapshot.json, and delete the
-- drizzle.__drizzle_migrations row for it.
DROP TABLE IF EXISTS "meeting_digest_send";
--> statement-breakpoint
DROP TABLE IF EXISTS "meeting";

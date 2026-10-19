-- Rollback for drizzle/0053_email_attachments_recipients.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Deploy the code that no longer declares the table
-- and the two columns first. Run scripts/sql/email-attachments-bucket.sql's cleanup block (or empty the Storage bucket
-- from the dashboard) BEFORE dropping email_attachment: afterwards nothing records which objects are still in Storage.
-- Scheduled emails keep working; one that was waiting with attachments would send without them, so cancel those first.
-- Also remove the journal entry (idx 53, tag 0053_email_attachments_recipients) and drizzle/meta/0053_snapshot.json, and
-- delete the drizzle.__drizzle_migrations row for it.
DROP TABLE IF EXISTS "email_attachment";
--> statement-breakpoint
ALTER TABLE "scheduled_email" DROP COLUMN IF EXISTS "recipient_person_ids";
--> statement-breakpoint
ALTER TABLE "scheduled_email" DROP COLUMN IF EXISTS "cc_addresses";

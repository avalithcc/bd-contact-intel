-- Rollback for drizzle/0041_outreach_sequences.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. DESTROYS every Sequence, member, draft and send
-- claim (children first, then sequence); nothing outside the outreach-sequences chain references them. If any send
-- claim matters, copy it out first: SELECT * FROM sequence_send_claim;
-- Then drops email_account.id and its unique constraint. Deploy the code that no longer declares email_account.id
-- BEFORE running this, or every query on email_account breaks the other way round.
DROP TABLE IF EXISTS "sequence_send_claim";
DROP TABLE IF EXISTS "sequence_draft";
DROP TABLE IF EXISTS "sequence_member";
DROP TABLE IF EXISTS "sequence";
ALTER TABLE "email_account" DROP CONSTRAINT IF EXISTS "email_account_id_unique";
ALTER TABLE "email_account" DROP COLUMN IF EXISTS "id";

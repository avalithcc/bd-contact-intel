-- draft-language-choice: a person may choose the language of a Sequence draft, and the choice is remembered on the member so a
-- regeneration reuses it instead of silently reverting. Three columns on "sequence_member", the same idiom as discard_reason /
-- discarded_by_bd_id / discarded_at: the choice ("es" or "en", validated by the app), the BD who chose, and when. The who/when pair IS the
-- record; there is no audit_log row for it.
-- ADDITIVE ONLY: three NULLABLE columns, no default, no backfill, no rewrite (catalog-only on Postgres 11+). The foreign key is added on a
-- column that is NULL in every row, so it validates nothing and the lock is brief.
--
-- NULL means "no human choice": the draft is written in the language the audience resolves to, exactly as before this migration.
-- NO DATA IS WRITTEN HERE. The choice never touches the postal address, which always follows the recipient's location (CAN-SPAM).
-- Deploy order: apply this BEFORE deploying the code that reads the columns (it selects them on every Sequence screen); the old code
-- ignores them, so applying first is safe. Rerun-safe: IF NOT EXISTS and the duplicate_object guard make a second run a no-op.
-- Rollback: 0061_sequence_member_draft_language_rollback.sql (deploy the code that no longer declares the columns first).
SET LOCAL lock_timeout = '3s';
--> statement-breakpoint
ALTER TABLE "sequence_member" ADD COLUMN IF NOT EXISTS "draft_language" text;
--> statement-breakpoint
ALTER TABLE "sequence_member" ADD COLUMN IF NOT EXISTS "draft_language_by_bd_id" uuid;
--> statement-breakpoint
ALTER TABLE "sequence_member" ADD COLUMN IF NOT EXISTS "draft_language_at" timestamp with time zone;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequence_member" ADD CONSTRAINT "sequence_member_draft_language_by_bd_id_bd_id_fk" FOREIGN KEY ("draft_language_by_bd_id") REFERENCES "public"."bd"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;

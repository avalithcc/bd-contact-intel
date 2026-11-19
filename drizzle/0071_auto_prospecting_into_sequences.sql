-- auto-prospecting writes into Sequences: prospect_draft keeps the signal and now points at the Sequence member that holds the text.
-- ADDITIVE ONLY, NO DATA WRITTEN: one nullable column and its index. Existing rows (the drafts from before this) read NULL and keep their own text.
-- Deploy order: apply this BEFORE the code; old code never references the new column. Rerun-safe.
-- Rollback: 0071_auto_prospecting_into_sequences_rollback.sql.
ALTER TABLE "prospect_draft" ADD COLUMN IF NOT EXISTS "sequence_member_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prospect_draft" ADD CONSTRAINT "prospect_draft_sequence_member_id_sequence_member_id_fk" FOREIGN KEY ("sequence_member_id") REFERENCES "public"."sequence_member"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospect_draft_member_idx" ON "prospect_draft" USING btree ("sequence_member_id");

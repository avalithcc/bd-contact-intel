-- contact-note-delete: soft-delete marker on activity, so a Contact note can be deleted while leaving a record.
-- ADDITIVE ONLY: two nullable columns and one FK. Nothing is dropped, rewritten or backfilled.
--   * ADD COLUMN with no default is a catalog change on Postgres 11+, not a table rewrite. IF NOT EXISTS makes a rerun a no-op.
--   * Every existing row reads NULL = "not deleted", which is correct.
--   * The row and its metadata (the note text) stay in place: a deletion is recoverable and the who/when survive.
--   * Code that does not know the columns keeps working, but Drizzle SELECTs every column schema.ts declares, so apply this
--     BEFORE deploying the code that declares them.
-- Rollback: 0045_activity_soft_delete_rollback.sql (deploy the code that no longer declares the columns first).
ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "deleted_by_bd_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity" ADD CONSTRAINT "activity_deleted_by_bd_id_bd_id_fk" FOREIGN KEY ("deleted_by_bd_id") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- Rollback for drizzle/0050_task_drop_legacy_subject_columns.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Restores the two columns, the lead FK and the
-- two indexes exactly as 0012 created them. Both columns were NULL on every row (0 of 24 `task` rows measured
-- 2026-10-01, see openspec/BACKLOG.md "task.lead_id and task.contact_id"), so nothing is lost by dropping them and
-- nothing needs to be repopulated here. Redeploy code that declares them again only if you also want to write them.
-- Also remove the journal entry (idx 50, tag 0050_task_drop_legacy_subject_columns) and drizzle/meta/0050_snapshot.json,
-- and delete the drizzle.__drizzle_migrations row for it.
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "lead_id" uuid;
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "contact_id" uuid;
ALTER TABLE "task" ADD CONSTRAINT "task_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX IF NOT EXISTS "task_lead_idx" ON "task" USING btree ("lead_id");
CREATE INDEX IF NOT EXISTS "task_contact_idx" ON "task" USING btree ("contact_id");

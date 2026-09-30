-- Rollback for drizzle/0028_timestamptz_slice_1.sql.
--
-- NOT part of the drizzle journal (drizzle/meta/_journal.json) on purpose —
-- drizzle-kit migrate only applies files it finds referenced there, so this
-- file is inert until someone runs it by hand. Never add it to the journal;
-- per the migration plan's "Rollback" note, a rollback is forward-only: it
-- is applied as its own manual step, never by editing/reverting an already-
-- applied migration in place.
--
-- Required order (plan's "Rollback" section):
--   1. Redeploy the previous code (schema.ts with these columns back to
--      plain `timestamp(...)`, no `withTimezone: true`) FIRST.
--   2. Only then run this file by hand against production.
-- Reversing that order re-creates the exact deploy-order hazard the plan
-- warns about ("The non-obvious risk: Drizzle's timestamp parser").
--
-- Values are unchanged by this cast: every row was written as UTC, so
-- `c AT TIME ZONE 'UTC'` on a timestamptz column converts it back to the
-- same wall-clock UTC instant as a naive timestamp.
SET LOCAL lock_timeout = '2s';
ALTER TABLE "audit_log" ALTER COLUMN "at" SET DATA TYPE timestamp USING "at" AT TIME ZONE 'UTC';
ALTER TABLE "bd" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "board_candidate" ALTER COLUMN "discovered_at" SET DATA TYPE timestamp USING "discovered_at" AT TIME ZONE 'UTC';
ALTER TABLE "board_candidate" ALTER COLUMN "decided_at" SET DATA TYPE timestamp USING "decided_at" AT TIME ZONE 'UTC';
ALTER TABLE "company_alias" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "company_category" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "company_probe" ALTER COLUMN "last_probed_at" SET DATA TYPE timestamp USING "last_probed_at" AT TIME ZONE 'UTC';
ALTER TABLE "company_property_history" ALTER COLUMN "at" SET DATA TYPE timestamp USING "at" AT TIME ZONE 'UTC';
ALTER TABLE "discovery_run" ALTER COLUMN "started_at" SET DATA TYPE timestamp USING "started_at" AT TIME ZONE 'UTC';
ALTER TABLE "discovery_run" ALTER COLUMN "finished_at" SET DATA TYPE timestamp USING "finished_at" AT TIME ZONE 'UTC';
ALTER TABLE "duplicate_candidate" ALTER COLUMN "decided_at" SET DATA TYPE timestamp USING "decided_at" AT TIME ZONE 'UTC';
ALTER TABLE "duplicate_candidate" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "email_domain_check" ALTER COLUMN "checked_at" SET DATA TYPE timestamp USING "checked_at" AT TIME ZONE 'UTC';
ALTER TABLE "email_never_log" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "lead_source" ALTER COLUMN "imported_at" SET DATA TYPE timestamp USING "imported_at" AT TIME ZONE 'UTC';
ALTER TABLE "linkedin_scrape_job" ALTER COLUMN "requested_at" SET DATA TYPE timestamp USING "requested_at" AT TIME ZONE 'UTC';
ALTER TABLE "linkedin_scrape_job" ALTER COLUMN "started_at" SET DATA TYPE timestamp USING "started_at" AT TIME ZONE 'UTC';
ALTER TABLE "linkedin_scrape_job" ALTER COLUMN "finished_at" SET DATA TYPE timestamp USING "finished_at" AT TIME ZONE 'UTC';
ALTER TABLE "merge_event" ALTER COLUMN "undone_at" SET DATA TYPE timestamp USING "undone_at" AT TIME ZONE 'UTC';
ALTER TABLE "merge_event" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "migration_run" ALTER COLUMN "approved_at" SET DATA TYPE timestamp USING "approved_at" AT TIME ZONE 'UTC';
ALTER TABLE "migration_run" ALTER COLUMN "executed_at" SET DATA TYPE timestamp USING "executed_at" AT TIME ZONE 'UTC';
ALTER TABLE "migration_run" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "person_id_map" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "person_property_history" ALTER COLUMN "at" SET DATA TYPE timestamp USING "at" AT TIME ZONE 'UTC';
ALTER TABLE "saved_view" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "saved_view" ALTER COLUMN "updated_at" SET DATA TYPE timestamp USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "signal" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "sync_run" ALTER COLUMN "started_at" SET DATA TYPE timestamp USING "started_at" AT TIME ZONE 'UTC';
ALTER TABLE "sync_run" ALTER COLUMN "finished_at" SET DATA TYPE timestamp USING "finished_at" AT TIME ZONE 'UTC';
ALTER TABLE "target_company" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "target_company" ALTER COLUMN "startup_classified_at" SET DATA TYPE timestamp USING "startup_classified_at" AT TIME ZONE 'UTC';
ALTER TABLE "task_digest_send" ALTER COLUMN "sent_at" SET DATA TYPE timestamp USING "sent_at" AT TIME ZONE 'UTC';
ALTER TABLE "task_digest_send" ALTER COLUMN "created_at" SET DATA TYPE timestamp USING "created_at" AT TIME ZONE 'UTC';

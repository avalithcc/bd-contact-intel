-- Slice 1 of the naive-timestamp -> timestamptz migration plan
-- (openspec/decisions/2026-09-30-timestamptz-migration-plan.md). Small,
-- low-traffic tables only. Every existing value is already UTC, so
-- `USING c AT TIME ZONE 'UTC'` reinterprets the naive wall-clock value as
-- that same UTC instant — no value changes, only the column's declared
-- type. `SET LOCAL lock_timeout` makes a blocked ALTER abort instead of
-- queuing and exhausting the 3-connection production pool (see the plan's
-- "Required sequence for each slice").
SET LOCAL lock_timeout = '2s';--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "at" SET DATA TYPE timestamp with time zone USING "at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "bd" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "board_candidate" ALTER COLUMN "discovered_at" SET DATA TYPE timestamp with time zone USING "discovered_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "board_candidate" ALTER COLUMN "decided_at" SET DATA TYPE timestamp with time zone USING "decided_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "company_alias" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "company_category" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "company_probe" ALTER COLUMN "last_probed_at" SET DATA TYPE timestamp with time zone USING "last_probed_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "company_property_history" ALTER COLUMN "at" SET DATA TYPE timestamp with time zone USING "at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "discovery_run" ALTER COLUMN "started_at" SET DATA TYPE timestamp with time zone USING "started_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "discovery_run" ALTER COLUMN "finished_at" SET DATA TYPE timestamp with time zone USING "finished_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "duplicate_candidate" ALTER COLUMN "decided_at" SET DATA TYPE timestamp with time zone USING "decided_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "duplicate_candidate" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "email_domain_check" ALTER COLUMN "checked_at" SET DATA TYPE timestamp with time zone USING "checked_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "email_never_log" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "lead_source" ALTER COLUMN "imported_at" SET DATA TYPE timestamp with time zone USING "imported_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "linkedin_scrape_job" ALTER COLUMN "requested_at" SET DATA TYPE timestamp with time zone USING "requested_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "linkedin_scrape_job" ALTER COLUMN "started_at" SET DATA TYPE timestamp with time zone USING "started_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "linkedin_scrape_job" ALTER COLUMN "finished_at" SET DATA TYPE timestamp with time zone USING "finished_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "merge_event" ALTER COLUMN "undone_at" SET DATA TYPE timestamp with time zone USING "undone_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "merge_event" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "migration_run" ALTER COLUMN "approved_at" SET DATA TYPE timestamp with time zone USING "approved_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "migration_run" ALTER COLUMN "executed_at" SET DATA TYPE timestamp with time zone USING "executed_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "migration_run" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "person_id_map" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "person_property_history" ALTER COLUMN "at" SET DATA TYPE timestamp with time zone USING "at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "saved_view" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "saved_view" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "signal" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "sync_run" ALTER COLUMN "started_at" SET DATA TYPE timestamp with time zone USING "started_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "sync_run" ALTER COLUMN "finished_at" SET DATA TYPE timestamp with time zone USING "finished_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "target_company" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "target_company" ALTER COLUMN "startup_classified_at" SET DATA TYPE timestamp with time zone USING "startup_classified_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "task_digest_send" ALTER COLUMN "sent_at" SET DATA TYPE timestamp with time zone USING "sent_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "task_digest_send" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';

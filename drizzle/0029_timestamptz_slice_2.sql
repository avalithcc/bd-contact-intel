-- Slice 2 of the naive-timestamp -> timestamptz migration plan
-- (openspec/decisions/2026-09-30-timestamptz-migration-plan.md). Imported
-- tables: job_posting, contact, conversation, message. Every existing value
-- is already UTC, so `USING c AT TIME ZONE 'UTC'` reinterprets the naive
-- wall-clock value as that same UTC instant — no value changes, only the
-- column's declared type. `SET LOCAL lock_timeout` makes a blocked ALTER
-- abort instead of queuing and exhausting the 3-connection production pool
-- (see the plan's "Required sequence for each slice").
SET LOCAL lock_timeout = '2s';--> statement-breakpoint
ALTER TABLE "job_posting" ALTER COLUMN "posted_at" SET DATA TYPE timestamp with time zone USING "posted_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "job_posting" ALTER COLUMN "first_seen" SET DATA TYPE timestamp with time zone USING "first_seen" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "job_posting" ALTER COLUMN "last_seen" SET DATA TYPE timestamp with time zone USING "last_seen" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "job_posting" ALTER COLUMN "closed_at" SET DATA TYPE timestamp with time zone USING "closed_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "contact" ALTER COLUMN "first_message_at" SET DATA TYPE timestamp with time zone USING "first_message_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "contact" ALTER COLUMN "last_message_at" SET DATA TYPE timestamp with time zone USING "last_message_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "contact" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "conversation" ALTER COLUMN "first_message_at" SET DATA TYPE timestamp with time zone USING "first_message_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "conversation" ALTER COLUMN "last_message_at" SET DATA TYPE timestamp with time zone USING "last_message_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "conversation" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "message" ALTER COLUMN "sent_at" SET DATA TYPE timestamp with time zone USING "sent_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "message" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';

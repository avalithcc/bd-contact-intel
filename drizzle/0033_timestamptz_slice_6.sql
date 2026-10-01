-- Slice 6 (final) of the naive-timestamp -> timestamptz migration plan
-- (openspec/decisions/2026-09-30-timestamptz-migration-plan.md). Scope:
-- person_bd_connection (first_message_at, last_message_at, created_at),
-- email_account (last_synced_at, reconnect_banner_dismissed_at, connected_at,
-- disconnected_at, updated_at), email_message (sent_at, created_at) and
-- follow_up_queue_item (last_touch_at, created_at, updated_at). Every
-- existing value is already UTC, so `USING c AT TIME ZONE 'UTC'`
-- reinterprets the naive wall-clock value as that same UTC instant — no
-- value changes, only the column's declared type. `SET LOCAL lock_timeout`
-- makes a blocked ALTER abort instead of queuing and exhausting the
-- 3-connection production pool (see the plan's "Required sequence for each
-- slice").
SET LOCAL lock_timeout = '2s';--> statement-breakpoint
ALTER TABLE "person_bd_connection" ALTER COLUMN "first_message_at" SET DATA TYPE timestamp with time zone USING "first_message_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "person_bd_connection" ALTER COLUMN "last_message_at" SET DATA TYPE timestamp with time zone USING "last_message_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "person_bd_connection" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "email_account" ALTER COLUMN "last_synced_at" SET DATA TYPE timestamp with time zone USING "last_synced_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "email_account" ALTER COLUMN "reconnect_banner_dismissed_at" SET DATA TYPE timestamp with time zone USING "reconnect_banner_dismissed_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "email_account" ALTER COLUMN "connected_at" SET DATA TYPE timestamp with time zone USING "connected_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "email_account" ALTER COLUMN "disconnected_at" SET DATA TYPE timestamp with time zone USING "disconnected_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "email_account" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "email_message" ALTER COLUMN "sent_at" SET DATA TYPE timestamp with time zone USING "sent_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "email_message" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "follow_up_queue_item" ALTER COLUMN "last_touch_at" SET DATA TYPE timestamp with time zone USING "last_touch_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "follow_up_queue_item" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "follow_up_queue_item" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';

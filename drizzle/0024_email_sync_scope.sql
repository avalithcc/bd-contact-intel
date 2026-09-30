ALTER TABLE "email_account" ADD COLUMN "granted_scopes" text;--> statement-breakpoint
ALTER TABLE "email_account" ADD COLUMN "history_id" text;--> statement-breakpoint
ALTER TABLE "email_account" ADD COLUMN "last_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "email_account" ADD COLUMN "sync_error" text;
ALTER TABLE "target_company" ADD COLUMN "is_startup" boolean;--> statement-breakpoint
ALTER TABLE "target_company" ADD COLUMN "startup_classified_at" timestamp;--> statement-breakpoint
ALTER TABLE "target_company" ADD COLUMN "startup_reason" text;
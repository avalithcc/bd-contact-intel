-- tender relevance: the model's verdict (ai_relevant + ai_reason) and a human override on each tender.
-- ADDITIVE ONLY: four nullable columns on `tender`, no default, no backfill. NO DATA IS WRITTEN HERE: every existing row reads
-- as "unclassified", which the app SHOWS (never hides) until the next import classifies it or a human decides.
-- relevance_override wins over ai_relevant and is never written by an import (see src/lib/tenders/relevance.ts).
-- Deploy order: apply this BEFORE the code that reads the columns; old code never references them.
-- Rerun-safe: IF NOT EXISTS makes a second run a no-op.
-- Rollback: 0068_tender_relevance_rollback.sql (deploy the code that no longer declares the columns first).
ALTER TABLE "tender" ADD COLUMN IF NOT EXISTS "ai_relevant" boolean;--> statement-breakpoint
ALTER TABLE "tender" ADD COLUMN IF NOT EXISTS "ai_reason" text;--> statement-breakpoint
ALTER TABLE "tender" ADD COLUMN IF NOT EXISTS "ai_classified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tender" ADD COLUMN IF NOT EXISTS "relevance_override" boolean;

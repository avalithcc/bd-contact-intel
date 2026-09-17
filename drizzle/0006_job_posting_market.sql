-- Hand-written incremental migration, same rationale as 0002-0005 (see
-- those files): this project historically used `drizzle-kit push` directly
-- against the DB, so a freshly generated migration would emit baseline DDL
-- that silently no-ops rather than adding the new column/index. Both
-- statements here are additive and idempotent (IF NOT EXISTS).
--
-- Adds the "market" dimension to job_posting: a coarse geography bucket
-- ("latam" | "us" | "other") classified from `location` at sync time (see
-- src/lib/hiring/markets.ts#classifyMarket and src/lib/hiring/sync.ts,
-- which used to DROP every posting whose location didn't match a
-- per-company country_filter — it no longer does, see the comment on
-- target_company.country_filter in src/db/schema.ts). Existing rows are
-- left NULL here; run scripts/backfill-posting-markets.ts after this
-- migration to classify them.
ALTER TABLE "job_posting" ADD COLUMN IF NOT EXISTS "market" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_posting_market_closed_idx" ON "job_posting" USING btree ("market","closed_at");

-- Hand-written incremental migration, same rationale as 0000: the project
-- historically used `drizzle-kit push` directly against the DB, so a
-- freshly generated migration for an existing table would emit
-- `CREATE TABLE IF NOT EXISTS` baseline DDL for `contact` that silently
-- no-ops rather than adding the new column. See drizzle/0000_*.sql.
--
-- Adds the shared `company_category` mapping table (company name ->
-- industry category, no BD ownership info — see src/db/schema.ts) and a
-- `company_category` column on `contact` holding the resolved category per
-- contact, computed at import/backfill time from that table (see
-- src/lib/companyCategories.ts). Existing rows are NULL until the backfill
-- script (scripts/backfill-company-categories.ts) is run — see that file
-- for instructions. The mapping table itself must be seeded first via
-- scripts/seed-company-categories.ts (never committed to this repo).
CREATE TABLE IF NOT EXISTS "company_category" (
	"key" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "company_category" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_bd_company_category_idx" ON "contact" USING btree ("bd_id","company_category");

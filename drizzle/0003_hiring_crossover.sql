-- Hand-written incremental migration, same rationale as 0001/0002 (see
-- those files): the project historically used `drizzle-kit push` directly
-- against the DB, so a freshly generated migration for the existing
-- `contact` table would emit `CREATE TABLE IF NOT EXISTS` baseline DDL that
-- silently no-ops rather than adding the new column.
--
-- Adds the contacts <-> hiring-signals crossover:
--  - `company_alias`: alternate normalized company keys that resolve to a
--    `target_company` (e.g. a legal entity name vs. the brand name used on
--    LinkedIn). Seeded via the optional `aliases` field in
--    scripts/seed-target-companies.ts. Shared across BDs, no bd_id, same
--    rationale as `target_company` (see drizzle/0002).
--  - `contact.company_key`: the normalized key for `contact.company` (see
--    src/lib/companyCategories.ts#normalizeCompanyKey), computed at
--    import/backfill time, same pattern as `role_group` (drizzle/0000) and
--    `company_category` (drizzle/0001). Existing rows are NULL until the
--    backfill script (scripts/backfill-company-keys.ts) is run — see that
--    file for instructions.
CREATE TABLE IF NOT EXISTS "company_alias" (
	"alias_key" text PRIMARY KEY NOT NULL,
	"company_key" text NOT NULL REFERENCES "target_company"("company_key") ON DELETE CASCADE,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_alias_company_key_idx" ON "company_alias" USING btree ("company_key");
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "company_key" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_bd_company_key_idx" ON "contact" USING btree ("bd_id","company_key");

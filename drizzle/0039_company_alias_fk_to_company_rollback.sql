-- Rollback for drizzle/0039_company_alias_fk_to_company.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Restores the FK to target_company with
-- ON DELETE CASCADE. FAILS while any alias points at a key that is not a target_company (every alias written by
-- scripts/merge-companies.ts for a non-target survivor): delete those rows first (their audit_log row, action
-- 'merge_companies', lists them), or leave the FK on company.
ALTER TABLE "company_alias" DROP CONSTRAINT IF EXISTS "company_alias_company_key_company_company_key_fk";
ALTER TABLE "company_alias" ADD CONSTRAINT "company_alias_company_key_target_company_company_key_fk" FOREIGN KEY ("company_key") REFERENCES "public"."target_company"("company_key") ON DELETE cascade ON UPDATE no action;

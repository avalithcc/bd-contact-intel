-- Rollback for drizzle/0038_company_linkedin_url.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand, and
-- only after the code that reads/writes company.linkedin_url is no longer
-- deployed (the company record page selects the column). Drops the column
-- and every LinkedIn URL stored in it (company_property_history rows with
-- property = 'linkedinUrl' remain as the audit trail of who set what, and
-- can be used to restore the values).
ALTER TABLE "company" DROP COLUMN IF EXISTS "linkedin_url";

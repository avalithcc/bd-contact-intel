-- Rollback for drizzle/0037_company_client_status.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand, and
-- only after the code that reads/writes company.client_status is no longer
-- deployed. Drops the column and every active/inactive flag stored in it
-- (company_property_history rows with property = 'clientStatus' remain as the
-- audit trail of who set what, and can be used to restore the values).
ALTER TABLE "company" DROP COLUMN IF EXISTS "client_status";

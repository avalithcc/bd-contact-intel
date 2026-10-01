-- Rollback for drizzle/0035_bd_signature_html.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand, and
-- only after the code that reads/writes bd.signature_html is no longer
-- deployed. Drops the column and every signature stored in it.
ALTER TABLE "bd" DROP COLUMN IF EXISTS "signature_html";

-- Rollback for drizzle/0034_person_contact_type.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand, and
-- only after the code that reads/writes person.contact_type is no longer
-- deployed. Drops the column and every value in it.
ALTER TABLE "person" DROP COLUMN IF EXISTS "contact_type";

-- Rollback for drizzle/0046_unaccent.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Deploy the code that no longer calls
-- unaccent() BEFORE running this, or every contact, company, lead, task and roster search errors with
-- "function unaccent(text) does not exist". Loses nothing: the extension owns no data. Also remove the journal entry
-- (tag 0046_unaccent) and its snapshot, and delete the drizzle.__drizzle_migrations row for it, or the next migrate
-- believes this migration is still applied.
-- No CASCADE on purpose: if an expression index or view came to depend on unaccent(), this must fail loudly.
DROP EXTENSION IF EXISTS unaccent;

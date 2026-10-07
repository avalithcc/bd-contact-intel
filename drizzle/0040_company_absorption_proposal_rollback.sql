-- Rollback for drizzle/0040_company_absorption_proposal.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. Drops the table, its indexes, FKs and RLS
-- setting with it. DESTROYS every proposal, including the applied/rejected history; nothing else references the
-- table. If any proposal matters, copy it out first: SELECT * FROM company_absorption_proposal;
DROP TABLE IF EXISTS "company_absorption_proposal";

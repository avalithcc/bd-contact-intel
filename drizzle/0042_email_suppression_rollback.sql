-- Rollback for drizzle/0042_email_suppression.sql.
--
-- NOT part of the drizzle journal on purpose: inert until run by hand. DESTROYS every suppression entry and every
-- unsubscribe token. Suppression entries are a legal record of opt-outs: if any row exists, copy them out first
-- (SELECT * FROM email_suppression;) and restore them after, or recipients who opted out can be emailed again.
-- Deploy the code that no longer declares these tables BEFORE running this.
DROP TABLE IF EXISTS "sequence_unsubscribe_token";
DROP TABLE IF EXISTS "email_suppression";

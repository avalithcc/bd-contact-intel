-- preferred-language: the language a BD said a person wants to be written to ('es' | 'en'), one nullable column on "person". It is a contact
-- property like the others: written through the property editor (updateContactProperty), so person_property_history records who and when.
-- NULL = "Automático": the draft language is decided by the audience chain exactly as before this migration. A value wins over that chain for
-- the LANGUAGE of the outreach draft only; it never changes the legal address, and it never unblocks a held contact (draftInput.ts).
-- ADDITIVE ONLY: one NULLABLE column, no default, no backfill, no rewrite (catalog-only on Postgres 11+). NO DATA IS WRITTEN HERE.
-- Validated by the app at the write boundary (languageChoice.ts), no CHECK, same convention as contact_type.
-- Deploy order: apply this BEFORE deploying the code that reads the column (the contact record and every Sequence draft select it); the old
-- code ignores it, so applying first is safe. Rerun-safe: IF NOT EXISTS makes a second run a no-op.
-- Rollback: 0063_person_preferred_language_rollback.sql (deploy the code that no longer declares the column first).
SET LOCAL lock_timeout = '3s';
--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN IF NOT EXISTS "preferred_language" text;
--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;

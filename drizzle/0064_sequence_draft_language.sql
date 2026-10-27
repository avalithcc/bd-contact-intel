-- draft-language-mismatch: the language a Sequence draft was composed in ('es' | 'en'), one nullable column on "sequence_draft". It is written
-- at generation, regeneration and reminder drafting, from the same resolveDraftLanguage result that picks the footer sentence, so it is exact.
-- It lets approval, the card and the release re-check refuse a draft whose language differs from the one we would write in today (reason
-- code wrong_language), and it gives the step 2 reminder the language of step 1 to follow.
-- NULL = unknown: every row stored before this migration stays NULL and is NEVER flagged. No backfill on purpose: the opt-out sentence in the body
-- is not an exact signal (drafts stored before it was translated hold the English one on a Spanish body; measured read-only against production,
-- scripts/measure/draft-language-mismatch.ts, 2 of 12 sendable drafts would have been falsely flagged on day 1).
-- ADDITIVE ONLY: one NULLABLE column, no default, no backfill, no rewrite (catalog-only on Postgres 11+). NO DATA IS WRITTEN HERE.
-- Validated by the app at the write boundary (languageChoice.ts parseLanguageChoice), no CHECK, same convention as sequence_member.draft_language.
-- Deploy order: apply this BEFORE deploying the code that reads the column (the detail read and the release read select it); the old code
-- ignores it, so applying first is safe. Rerun-safe: IF NOT EXISTS makes a second run a no-op.
-- Rollback: 0064_sequence_draft_language_rollback.sql (deploy the code that no longer declares the column first).
SET LOCAL lock_timeout = '3s';
--> statement-breakpoint
ALTER TABLE "sequence_draft" ADD COLUMN IF NOT EXISTS "language" text;
--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;

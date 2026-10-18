-- Phone search: equality on the last 8 digits of the stored phone (src/lib/search/phoneQuery.ts, PHONE_SUFFIX_LENGTH).
-- ADDITIVE ONLY: two expression indexes, nothing existing is altered. Guarded, so a rerun is a no-op.
-- Rollback: 0051_person_phone_digits_suffix_idx_rollback.sql (not in the journal; run by hand).
CREATE INDEX IF NOT EXISTS "person_phone_digits_suffix_idx" ON "person" USING btree ((right(regexp_replace("phone", '\D', '', 'g'), 8)));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_mobile_phone_digits_suffix_idx" ON "person" USING btree ((right(regexp_replace("mobile_phone", '\D', '', 'g'), 8)));

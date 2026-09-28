ALTER TABLE "person" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "mobile_phone" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_phone_digits_idx" ON "person" USING btree ((regexp_replace("phone", '\D', '', 'g')));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_mobile_phone_digits_idx" ON "person" USING btree ((regexp_replace("mobile_phone", '\D', '', 'g')));
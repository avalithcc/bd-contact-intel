ALTER TABLE "company" ADD COLUMN "domain" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_domain_idx" ON "company" USING btree ("domain") WHERE "company"."domain" is not null;
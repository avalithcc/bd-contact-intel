CREATE INDEX IF NOT EXISTS "person_industry_idx" ON "person" USING btree ("industry");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_seniority_idx" ON "person" USING btree ("seniority");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_email_status_idx" ON "person" USING btree ("email_status");
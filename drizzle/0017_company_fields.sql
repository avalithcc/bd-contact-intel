CREATE TABLE IF NOT EXISTS "company_property_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_key" text NOT NULL,
	"property" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_by_bd_id" uuid,
	"source" text NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "industry" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "owner_bd_id" uuid;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "country" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_property_history" ADD CONSTRAINT "company_property_history_company_key_company_company_key_fk" FOREIGN KEY ("company_key") REFERENCES "public"."company"("company_key") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_property_history" ADD CONSTRAINT "company_property_history_changed_by_bd_id_bd_id_fk" FOREIGN KEY ("changed_by_bd_id") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_property_history_company_idx" ON "company_property_history" USING btree ("company_key");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company" ADD CONSTRAINT "company_owner_bd_id_bd_id_fk" FOREIGN KEY ("owner_bd_id") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_owner_idx" ON "company" USING btree ("owner_bd_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_industry_idx" ON "company" USING btree ("industry");
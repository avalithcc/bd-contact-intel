CREATE TABLE IF NOT EXISTS "email_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bd_id" uuid NOT NULL,
	"gmail_message_id" text NOT NULL,
	"gmail_thread_id" text NOT NULL,
	"direction" text NOT NULL,
	"person_id" uuid,
	"from_address" text NOT NULL,
	"to_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cc_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" text,
	"body_text" text,
	"body_truncated" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp NOT NULL,
	"matched_email" text NOT NULL,
	"match_confidence" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_message_bd_gmail_message_unique" UNIQUE("bd_id","gmail_message_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_message_person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_message_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"matched_email" text NOT NULL,
	"match_confidence" text NOT NULL,
	CONSTRAINT "email_message_person_unique" UNIQUE("email_message_id","person_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_never_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bd_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_never_log_bd_kind_value_unique" UNIQUE("bd_id","kind","value")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_message" ADD CONSTRAINT "email_message_bd_id_bd_id_fk" FOREIGN KEY ("bd_id") REFERENCES "public"."bd"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_message" ADD CONSTRAINT "email_message_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_message_person" ADD CONSTRAINT "email_message_person_email_message_id_email_message_id_fk" FOREIGN KEY ("email_message_id") REFERENCES "public"."email_message"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_message_person" ADD CONSTRAINT "email_message_person_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_never_log" ADD CONSTRAINT "email_never_log_bd_id_bd_id_fk" FOREIGN KEY ("bd_id") REFERENCES "public"."bd"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_message_bd_thread_idx" ON "email_message" USING btree ("bd_id","gmail_thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_message_bd_person_idx" ON "email_message" USING btree ("bd_id","person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_message_person_person_idx" ON "email_message_person" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_never_log_bd_idx" ON "email_never_log" USING btree ("bd_id");
--> statement-breakpoint
-- Close the anon/authenticated PostgREST gap on these new tables (same rule
-- as drizzle/0019_enable_rls.sql — the app connects as `postgres`, which
-- owns these tables and has BYPASSRLS, so this is invisible to the app
-- itself). Revert: ALTER TABLE public.<table> DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."email_message" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."email_message_person" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."email_never_log" ENABLE ROW LEVEL SECURITY;
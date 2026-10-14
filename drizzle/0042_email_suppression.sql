-- outreach-sequences, PR 3: company-wide send suppression and hashed unsubscribe tokens. Nothing reads or writes
-- either table yet (see tests/unit/sequencesInert.test.ts); both stay empty until the unsubscribe route lands in PR 13.
--
-- email_suppression has NO bd_id on purpose: CAN-SPAM binds the company, not one BD. It is not email_never_log, which is
-- per BD and makes the Gmail classifier discard the ENTIRE message when any participant matches (a suppressed person's
-- replies would vanish). kind is 'address' | 'domain', value is normalized lowercase, source is free text validated at
-- the write boundary (repo convention, no CHECK). person_id / sequence_member_id are provenance only and SET NULL, so
-- an opt-out outlives the rows it came from. unique(kind, value) makes the insert idempotent (ON CONFLICT DO NOTHING).
--
-- sequence_unsubscribe_token stores only the SHA-256 of the token: a database read cannot be turned into working links.
--
-- RLS is enabled on both tables with NO policies, the posture of 0019_enable_rls.sql, 0040 and 0041: the app connects
-- as `postgres` (owner, BYPASSRLS), so only anon/authenticated are denied. Rollback: 0042_email_suppression_rollback.sql.
CREATE TABLE IF NOT EXISTS "email_suppression" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"source" text NOT NULL,
	"recorded_by_bd_id" uuid,
	"person_id" uuid,
	"sequence_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_suppression_kind_value_unique" UNIQUE("kind","value")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sequence_unsubscribe_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"sequence_member_id" uuid NOT NULL,
	"email_normalized" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sequence_unsubscribe_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_suppression" ADD CONSTRAINT "email_suppression_recorded_by_bd_id_bd_id_fk" FOREIGN KEY ("recorded_by_bd_id") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_suppression" ADD CONSTRAINT "email_suppression_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_suppression" ADD CONSTRAINT "email_suppression_sequence_member_id_sequence_member_id_fk" FOREIGN KEY ("sequence_member_id") REFERENCES "public"."sequence_member"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequence_unsubscribe_token" ADD CONSTRAINT "sequence_unsubscribe_token_sequence_member_id_sequence_member_id_fk" FOREIGN KEY ("sequence_member_id") REFERENCES "public"."sequence_member"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sequence_unsubscribe_token_member_idx" ON "sequence_unsubscribe_token" USING btree ("sequence_member_id");
--> statement-breakpoint
ALTER TABLE "public"."email_suppression" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."sequence_unsubscribe_token" ENABLE ROW LEVEL SECURITY;

-- outreach-sequences, PR 1: the data model. Nothing reads or writes any of this yet (see tests/unit/sequencesInert.test.ts).
--
-- email_account.id (design D3). email_account's primary key stays bd_id; id is a second, referenceable identity so
-- sequence.email_account_id and sequence_send_claim.sending_account_id can point at a mailbox instead of at "whoever
-- owns the Sequence". A UNIQUE column is a legal FK target in Postgres. Three steps, in this order:
--   1. ADD COLUMN id uuid DEFAULT gen_random_uuid()  the default is VOLATILE, so Postgres rewrites the table and
--      evaluates it per row: every existing row gets a DISTINCT id, not one shared value.
--   2. SET NOT NULL                                  safe once every row has a value.
--   3. ADD CONSTRAINT ... UNIQUE (id)                must exist BEFORE any FK below references the column.
-- GATE 0.1: apply this to production BEFORE merging the PR that carries the matching schema.ts. Drizzle selects every
-- declared column, so schema.ts with email_account.id against a database without it breaks every query on email_account.
--
-- state / outcome are free text validated at the write boundary, no CHECK (repo convention: client_status, contact_type).
-- sequence has no is_active column: "active" is derived. sequence_send_claim is the at-most-once claim of design D10:
-- the partial unique index ignores 'failed' rows, so a failed send stays as history and the step can be claimed again.
--
-- RLS is enabled on the four new tables with NO policies, the posture of 0019_enable_rls.sql and 0040: the app connects
-- as `postgres` (owner, BYPASSRLS), so only anon/authenticated are denied. Rollback: 0041_outreach_sequences_rollback.sql.
ALTER TABLE "email_account" ADD COLUMN "id" uuid DEFAULT gen_random_uuid();
--> statement-breakpoint
ALTER TABLE "email_account" ALTER COLUMN "id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_account" ADD CONSTRAINT "email_account_id_unique" UNIQUE ("id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sequence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_bd_id" uuid NOT NULL,
	"email_account_id" uuid NOT NULL,
	"daily_send_cap" integer DEFAULT 5 NOT NULL,
	"schedule" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sequence_draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence_member_id" uuid NOT NULL,
	"step" smallint NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"edited_by_bd_id" uuid,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_bd_id" uuid,
	"approved_at" timestamp with time zone,
	"approved_by_bd_id" uuid,
	"scheduled_for" timestamp with time zone,
	CONSTRAINT "sequence_draft_member_step_unique" UNIQUE("sequence_member_id","step")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sequence_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"state" text NOT NULL,
	"sent_at" timestamp with time zone,
	"replied_at" timestamp with time zone,
	"reminder_due_at" timestamp with time zone,
	"discard_reason" text,
	"discarded_by_bd_id" uuid,
	"discarded_at" timestamp with time zone,
	"hold_reason" text,
	"hold_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sequence_member_sequence_person_unique" UNIQUE("sequence_id","person_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sequence_send_claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence_member_id" uuid NOT NULL,
	"step" smallint NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"sending_account_id" uuid NOT NULL,
	"miami_send_date" date,
	"gmail_message_id" text,
	"rfc_message_id" text,
	"gmail_thread_id" text,
	"error" text,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequence" ADD CONSTRAINT "sequence_owner_bd_id_bd_id_fk" FOREIGN KEY ("owner_bd_id") REFERENCES "public"."bd"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequence" ADD CONSTRAINT "sequence_email_account_id_email_account_id_fk" FOREIGN KEY ("email_account_id") REFERENCES "public"."email_account"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequence_draft" ADD CONSTRAINT "sequence_draft_sequence_member_id_sequence_member_id_fk" FOREIGN KEY ("sequence_member_id") REFERENCES "public"."sequence_member"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequence_draft" ADD CONSTRAINT "sequence_draft_edited_by_bd_id_bd_id_fk" FOREIGN KEY ("edited_by_bd_id") REFERENCES "public"."bd"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequence_draft" ADD CONSTRAINT "sequence_draft_reviewed_by_bd_id_bd_id_fk" FOREIGN KEY ("reviewed_by_bd_id") REFERENCES "public"."bd"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequence_draft" ADD CONSTRAINT "sequence_draft_approved_by_bd_id_bd_id_fk" FOREIGN KEY ("approved_by_bd_id") REFERENCES "public"."bd"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequence_member" ADD CONSTRAINT "sequence_member_sequence_id_sequence_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequence"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequence_member" ADD CONSTRAINT "sequence_member_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequence_member" ADD CONSTRAINT "sequence_member_discarded_by_bd_id_bd_id_fk" FOREIGN KEY ("discarded_by_bd_id") REFERENCES "public"."bd"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequence_send_claim" ADD CONSTRAINT "sequence_send_claim_sequence_member_id_sequence_member_id_fk" FOREIGN KEY ("sequence_member_id") REFERENCES "public"."sequence_member"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequence_send_claim" ADD CONSTRAINT "sequence_send_claim_sending_account_id_email_account_id_fk" FOREIGN KEY ("sending_account_id") REFERENCES "public"."email_account"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sequence_member_sequence_state_idx" ON "sequence_member" USING btree ("sequence_id","state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sequence_member_person_idx" ON "sequence_member" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sequence_send_claim_active_idx" ON "sequence_send_claim" USING btree ("sequence_member_id","step") WHERE "sequence_send_claim"."outcome" <> 'failed';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sequence_send_claim_sent_account_date_idx" ON "sequence_send_claim" USING btree ("sending_account_id","miami_send_date") WHERE "sequence_send_claim"."outcome" = 'sent';
--> statement-breakpoint
ALTER TABLE "public"."sequence" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."sequence_member" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."sequence_draft" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."sequence_send_claim" ENABLE ROW LEVEL SECURITY;

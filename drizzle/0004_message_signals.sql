-- Hand-written incremental migration, same rationale as 0001/0002/0003 (see
-- those files): the project historically used `drizzle-kit push` directly
-- against the DB, so a freshly generated migration for the existing
-- `contact` table would emit `CREATE TABLE IF NOT EXISTS` baseline DDL that
-- silently no-ops rather than adding the new columns.
--
-- Adds LinkedIn-message signals (imported from messages.csv — see
-- src/lib/messagesCsv.ts and src/lib/queries.ts#importMessages):
--  - `conversation`: one row per LinkedIn thread, private to one BD.
--  - `message`: one row per message within a thread, private to one BD.
--    Message content is sensitive; every read path MUST scope by bd_id.
--  - New columns on `contact`, denormalized and recomputed in bulk after
--    every import (see src/lib/queries.ts#recomputeMessageSignals) rather
--    than incrementally. Existing rows default to zero/false/NULL until a
--    messages.csv is imported for that BD.
CREATE TABLE IF NOT EXISTS "conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bd_id" uuid NOT NULL REFERENCES "bd"("id") ON DELETE CASCADE,
	"external_id" text NOT NULL,
	"title" text,
	"peer_profile_key" text,
	"message_count" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"received_count" integer DEFAULT 0 NOT NULL,
	"first_message_at" timestamp,
	"last_message_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_bd_external_unique" ON "conversation" USING btree ("bd_id","external_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_bd_peer_idx" ON "conversation" USING btree ("bd_id","peer_profile_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_bd_last_message_idx" ON "conversation" USING btree ("bd_id","last_message_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bd_id" uuid NOT NULL REFERENCES "bd"("id") ON DELETE CASCADE,
	"conversation_id" uuid NOT NULL REFERENCES "conversation"("id") ON DELETE CASCADE,
	"sender_profile_key" text,
	"sender_name" text,
	"sent_at" timestamp NOT NULL,
	"subject" text,
	"content" text NOT NULL,
	"folder" text,
	"is_draft" boolean DEFAULT false NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "message_bd_content_hash_unique" ON "message" USING btree ("bd_id","content_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_bd_conversation_sent_idx" ON "message" USING btree ("bd_id","conversation_id","sent_at");
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "message_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "sent_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "received_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "first_message_at" timestamp;
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "last_message_at" timestamp;
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "initiated_by_me" boolean;
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "reciprocal" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_bd_last_message_idx" ON "contact" USING btree ("bd_id","last_message_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_bd_reciprocal_idx" ON "contact" USING btree ("bd_id","reciprocal");

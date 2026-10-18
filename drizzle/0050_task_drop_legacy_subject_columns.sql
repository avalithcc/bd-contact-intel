ALTER TABLE "task" DROP CONSTRAINT IF EXISTS "task_lead_id_lead_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "task_lead_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "task_contact_idx";--> statement-breakpoint
ALTER TABLE "task" DROP COLUMN IF EXISTS "lead_id";--> statement-breakpoint
ALTER TABLE "task" DROP COLUMN IF EXISTS "contact_id";
/**
 * Turns OFF `bd.email_reminders_enabled` for a BD who has left.
 *
 * Why this exists: reminderRows.ts says the flag is switched off "for the e2e test accounts (and any BD who left)",
 * but no offboarding script ever did the second half. Mariel Meza was revoked and her mailbox disconnected on
 * 2026-11-11, and the Gmail reconnect reminders kept going out to her — at the third one the system emails the owner
 * about a person who no longer works here.
 *
 * Dry run by default. Pass --execute to write.
 *   npx tsx --env-file=.env scripts/disable-reminders-for-departed-bd.ts <email> [--execute]
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  const email = process.argv[2];
  const execute = process.argv.includes("--execute");
  if (!email || email.startsWith("--")) {
    console.error("usage: … disable-reminders-for-departed-bd.ts <email> [--execute]");
    process.exit(1);
  }

  const before = (await db.execute(sql`
    select b.name, b.email, b.email_reminders_enabled, ea.status as gmail_status,
           (select count(*) from gmail_reminder_send g where g.bd_id = b.id and g.status = 'sent')::int as reminders_sent
    from bd b left join email_account ea on ea.bd_id = b.id
    where b.email = ${email}
  `)) as unknown as Array<Record<string, unknown>>;

  if (before.length === 0) {
    console.error(`no BD with email ${email}`);
    process.exit(1);
  }
  console.log("before:", JSON.stringify(before[0], null, 1));

  if (!execute) {
    console.log("\nDRY RUN — nothing written. Re-run with --execute to turn reminders off.");
    process.exit(0);
  }

  const updated = await db.execute(sql`
    update bd set email_reminders_enabled = false
    where email = ${email} and email_reminders_enabled
    returning name, email_reminders_enabled
  `);
  console.log("updated:", JSON.stringify(updated));
  process.exit(0);
}
void main();

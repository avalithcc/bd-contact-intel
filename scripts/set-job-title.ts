/**
 * Owner-run edit of one person's Cargo, through the app's OWN write path
 * (updateContactProperty -> planPropertyEdit, src/lib/contacts/propertyEditDb.ts):
 * the same function the contact record calls. Not a hand-written UPDATE, for two
 * reasons:
 *
 *   1. Saving a Cargo re-derives `role_group` (`derivedRoleGroup` ->
 *      classifyPosition). A raw UPDATE would leave the group derived from the
 *      OLD title, which is what mis-files a CIO as c_level_business.
 *   2. The edit writes `person_property_history` rows with source 'edit', which
 *      is what makes a value STICKY against the automatic writers (merge,
 *      import, backfill — see src/lib/identity/ownerRule.ts for the same rule on
 *      owners). A raw UPDATE would be overwritten by the next merge.
 *
 * DRY RUN IS THE DEFAULT. It loads the person, builds the plan and prints what
 * would change, writing nothing. Usage:
 *   npx tsx --env-file=.env scripts/set-job-title.ts --person=<id> --title="CIO"
 *   npx tsx --env-file=.env scripts/set-job-title.ts --person=<id> --title="CIO" --execute --actor=<bd id>
 *
 * REFUSES a person that is merged away (`merged_into_id` set): the edit belongs
 * on the survivor. EXIT CODES: 0 success, 1 bad arguments or a refusal.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { person } from "@/db/schema";
import { planPropertyEdit } from "@/lib/contacts/propertyEdit";
import { updateContactProperty } from "@/lib/contacts/propertyEditDb";

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function main() {
  const personId = arg("person");
  const title = arg("title");
  const actor = arg("actor");
  const execute = process.argv.includes("--execute");
  if (!personId || title === null) throw new Error('Usage: --person=<id> --title="CIO" [--execute --actor=<bd id>]');
  if (execute && !actor) throw new Error("--execute requires --actor=<bd id> for the history row.");

  const [row] = await db.select().from(person).where(eq(person.id, personId));
  if (!row) {
    console.log(`REFUSED: no person ${personId}.`);
    process.exit(1);
  }
  if (row.mergedIntoId) {
    console.log(`REFUSED: ${personId} is merged into ${row.mergedIntoId}. Edit the survivor.`);
    process.exit(1);
  }

  const plan = planPropertyEdit(row, "jobTitle", title, actor ?? "00000000-0000-0000-0000-000000000000");
  console.log(`${row.firstName} ${row.lastName} — ${row.company ?? "(sin empresa)"}`);
  console.log(`  jobTitle:  ${JSON.stringify(row.jobTitle)} -> ${JSON.stringify(title)}`);
  console.log(`  roleGroup: ${JSON.stringify(row.roleGroup)} -> ${JSON.stringify(plan.personUpdate?.roleGroup ?? row.roleGroup)}`);
  console.log(`  changed:   ${plan.changed}`);
  console.log(`  history rows: ${plan.historyRows.map((h) => `${h.property} (${h.source})`).join(", ") || "none"}`);

  if (!execute) {
    console.log("\nDRY RUN. Nothing written. Re-run with --execute --actor=<bd id> to apply.");
    process.exit(0);
  }
  const updated = await updateContactProperty(personId, "jobTitle", title, actor!);
  console.log(`\nDone. jobTitle=${JSON.stringify(updated.jobTitle)} roleGroup=${JSON.stringify(updated.roleGroup)}`);
  process.exit(0);
}

void main();

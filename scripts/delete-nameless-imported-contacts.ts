/**
 * Deletes the nameless contacts of the commercial-contacts import: persons with
 * source_key 'contactos-comerciales-2026-10' and BOTH first_name and last_name
 * NULL (the CEO's PDF gave an email and nothing else). The owner decided they go.
 *
 * WHY A SCRIPT AND NOT A DELETE: every table that references person cascades on
 * delete, so a plain DELETE would erase whatever a BD logged on them.
 *
 * GUARD (reused, not rewritten: src/lib/contactosComerciales/revert.ts and
 * readTouchFlags, the same code scripts/revert-contactos-comerciales-2026-10.ts
 * uses): a person is deleted ONLY when no activity, task, email_message,
 * email_message_person, signal, linkedin_scrape_job, follow_up_queue_item,
 * person_bd_connection, person_id_map, duplicate_candidate or merge_event points
 * at it, it was not merged away and is not a merge winner, there is no history
 * other than the import's, the owner is still the importer's and the status is
 * still 'new'. ANYTHING with a trace is reported by reason and KEPT.
 *
 * SCOPE, strictly: the selection is the source_key AND both names NULL, and
 * the DELETE re-checks both in SQL. --expect=<n> is the count the owner measured
 * (7): any other size refuses, the script never widens (or shrinks) the set.
 * Bounded: more than 100 matches refuses.
 *
 * ONE transaction under the identity lock, ONE audit_log row (action
 * 'delete_nameless_imported_contacts') holding the deleted ids and the deleted
 * rows. REVERT: re-INSERT metadata.deletedPersons into person (same ids).
 *
 * DRY RUN IS THE DEFAULT (read-only transaction). Counts only: no emails.
 * Usage (do NOT run --execute without the owner's approval):
 *   npx tsx --env-file=.env.local scripts/delete-nameless-imported-contacts.ts --expect=7
 *   npx tsx --env-file=.env.local scripts/delete-nameless-imported-contacts.ts --expect=7 --execute --actor=<bd id>
 *
 * EXIT CODES: 0 success (dry run or write, including "nothing deletable"); 1 bad
 * arguments, a selection mismatch, or any failed check (nothing written).
 */
import { dryRunNameless, executeNameless } from "../src/lib/namelessContacts/db";
import type { NamelessPlan } from "../src/lib/namelessContacts/plan";

function parseArgs(argv: readonly string[]) {
  let expect: number | null = null;
  let execute = false;
  let actor: string | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else if (arg.startsWith("--expect=")) expect = Number(arg.slice("--expect=".length));
    else throw new Error(`Unknown argument: ${arg}. Valid: --expect=<n>, --execute, --actor=<bd id>`);
  }
  if (expect === null || !Number.isInteger(expect) || expect < 0) throw new Error("Usage: delete-nameless-imported-contacts.ts --expect=<count> [--execute --actor=<bd id>]");
  if (execute && !actor) throw new Error("--execute requires --actor=<bd id> for the audit log.");
  return { expect, execute, actor };
}

function report(plan: NamelessPlan): string {
  return [
    `Nameless imported contacts selected: ${plan.deletable.length + plan.kept.length}`,
    `To DELETE (no trace at all): ${plan.deletable.length}`,
    `KEPT (something points at them): ${plan.kept.length}`,
    ...Object.entries(plan.keptReasons).sort().map(([reason, n]) => `    ${reason}: ${n}`),
  ].join("\n");
}

async function main() {
  const { expect, execute, actor } = parseArgs(process.argv.slice(2));
  if (!execute) {
    console.log("DRY RUN (read-only transaction)\n");
    console.log(report(await dryRunNameless(expect)));
    console.log("\nNothing written. Re-run with --execute --actor=<bd id> to apply.");
    return;
  }
  const { plan, auditLogId } = await executeNameless(expect, actor!);
  console.log(report(plan));
  console.log(auditLogId ? `\nDeleted ${plan.deletable.length}. audit_log id: ${auditLogId}` : "\nNothing to delete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });

/**
 * Removes "Freelance" / "Independiente" as employers. The owner: "Los freelance quitemoslos al igual que
 * Independientes. No me interesan." They are not companies, so those contacts end up with NO company and the junk
 * company records are deleted.
 *
 * MATCHING is on the squashed company_key (src/lib/nonCompanyEmployers/match.ts), not a list of strings: every
 * spelling is caught, "Freelance Studio" and "Club Atletico Independiente" are not. The dry run prints each matched
 * key with the display names found under it, so the owner sees exactly what will be cleared before approving.
 *
 * CONFIRMED LIST (--key=<company_key>, repeatable, and/or --file=<path>, one key per line, `#` comments skipped IN
 * FILE LINES ONLY -- a --key is taken literally, so a real key that starts with '#' can still be named):
 * when given, the built-in matcher is BYPASSED ENTIRELY and only the listed keys are acted on; without it,
 * behaviour is exactly the matcher above. The matcher is a CANDIDATE FINDER for the obvious variants. Anything
 * beyond them is confirmed by the owner by hand, because "independiente" and "autonomo" also sit inside real
 * company names and job titles ("Freelancer.com", "Directora Independiente", "Ciudad Autonoma de Buenos
 * Aires"), and a substring rule would clear real employers. A listed key that exists in no company_key table
 * is reported, and execute refuses (a typo must not pass as a no-op). Every guard below applies to listed
 * keys too: an explicit list confirms a key is not a company, it is NOT permission to delete rows other data
 * depends on, so a listed key that hits the STOP list is still refused.
 *
 * WHAT HAPPENS PER TABLE (all 14 company_key tables are accounted for; a test fails if one is added unhandled)
 *   person, contact, lead (CLEARED): company, company_key and company_category set to NULL (lead: company_key only;
 *     the imported company_raw/company_display text stays as source data). company_category is cleared too: it is
 *     looked up from the company, so with no company it describes nothing. One person_property_history row per
 *     cleared property, source 'company_cleanup' (never 'edit': that makes a contact's owner sticky and freezes it
 *     out of the automatic last-worked rule).
 *   board_candidate, company_probe (no FK, junk discovery state): rows deleted.
 *   company: rows deleted. Its company_property_history rows cascade away with it: field history of a record that no
 *     longer exists, counted in the audit row.
 *   activity, task, signal, company_alias, job_posting, sync_run, target_company (STOP): their FKs to company /
 *     target_company are ON DELETE CASCADE, so deleting a company that has any would silently delete real data, and
 *     a company-scoped activity/task with its company removed has no subject. If ANY such row exists on a matched
 *     key the run prints it and writes NOTHING. The dry run shows the same STOP.
 *
 * Bounded (5,000 cleared rows). Counts and company names only, never a person. One transaction, one audit_log row
 * (action 'clear_non_company_employers'). Execute locks the matched company rows first, so a concurrent insert of
 * an activity waits rather than being cascade-deleted.
 *
 * REVERT, from that audit row's metadata (in one transaction): re-insert `deletedCompanies` into company (notes were
 * not copied and stay empty); UPDATE person/contact/lead from `clearedPersons`/`clearedContacts`/`clearedLeads`
 * (id -> company, companyKey, companyCategory) WHERE company_key IS NULL, so a company a BD set since is kept;
 * re-insert nothing for `deletedBoardCandidates`/`deletedProbes` (discovery state, rebuilt by the next probe);
 * then DELETE FROM person_property_history WHERE source = 'company_cleanup' AND changed_by_bd_id = <actor> AND
 * at >= <audit at>. Cascaded company_property_history rows are not recoverable (counts are in the audit row).
 *
 * DRY RUN IS THE DEFAULT (read-only transaction). Usage (do NOT run --execute without the owner's approval):
 *   npx tsx --env-file=.env.local scripts/clear-non-company-employers.ts
 *   npx tsx --env-file=.env.local scripts/clear-non-company-employers.ts --file=confirmed-keys.txt [--key=<key>]
 *   npx tsx --env-file=.env.local scripts/clear-non-company-employers.ts [--file=...] --execute --actor=<bd id>
 *
 * EXIT CODES: 0 success (dry run or write, including "nothing to clear"); 1 bad arguments, a STOP, or any failed
 * check (nothing written).
 */
import { refCount } from "../src/lib/companyMerge/keys";
import { readFileSync } from "node:fs";
import { CLEARED_TABLES, DELETED_TABLES, parseKeyList, type ConfirmedKeyInput } from "../src/lib/nonCompanyEmployers/match";
import { dryRunCleanup, executeCleanup } from "../src/lib/nonCompanyEmployers/db";

function parseArgs(argv: readonly string[]) {
  let execute = false;
  let actor: string | null = null;
  // Tagged by origin: `#` opens a comment in a --file line only. A --key is the owner naming one key by hand, so a
  // key that starts with '#' reaches the run instead of vanishing as a comment. Sharing one array made such a key
  // impossible to name, and silent when it travelled beside others (see parseKeyList for the incident).
  const inputs: ConfirmedKeyInput[] = [];
  let listed = false;
  for (const a of argv) {
    if (a === "--execute") execute = true;
    else if (a.startsWith("--actor=")) actor = a.slice(8);
    else if (a.startsWith("--key=")) (listed = true), inputs.push({ value: a.slice(6), fromFile: false });
    else if (a.startsWith("--file="))
      (listed = true), inputs.push(...readFileSync(a.slice(7), "utf8").split("\n").map((value) => ({ value, fromFile: true })));
    else throw new Error(`Unknown argument: ${a}. Valid: --key=<company_key>, --file=<path>, --execute, --actor=<bd id>`);
  }
  if (execute && !actor) throw new Error("--execute requires --actor=<bd id> for the audit log.");
  return { execute, actor, keys: listed ? parseKeyList(inputs) : null };
}

async function main() {
  const { execute, actor, keys } = parseArgs(process.argv.slice(2));
  const r = execute ? await executeCleanup(actor!, keys) : await dryRunCleanup(keys);
  console.log(execute ? "EXECUTED\n" : "DRY RUN (read-only transaction)\n");
  if (r.unknown.length) console.log(`Listed keys found in no company_key table (typo?): ${r.unknown.join(", ")}\n`);
  if (!r.keys.length) return void console.log("No non-company employers found.");
  for (const k of r.keys) {
    const rows = [...CLEARED_TABLES, ...DELETED_TABLES].filter((t) => refCount(r.counts, t, k) > 0).map((t) => `${t}=${refCount(r.counts, t, k)}`);
    console.log(`${k}  [${[...new Set(r.names.get(k) ?? [])].join(" | ")}]  ${rows.join(" ")}`);
  }
  if (r.blockers.length) console.log(`\nSTOP, nothing would be deleted. These rows would cascade or be left subject-less:\n- ${r.blockers.join("\n- ")}`);
  console.log(execute ? `\nDone. audit_log id: ${"auditLogId" in r ? r.auditLogId : "-"}` : "\nNothing written. Re-run with --execute --actor=<bd id> to apply.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });

/**
 * Gives the ownerless WON companies an owner. The owner decided who: pass the
 * bd id with --owner=<bd id> (nothing is hardcoded).
 *
 * SELECTION: company.relationship_stage = 'won' AND owner_bd_id IS NULL. A
 * company that already has an owner is NEVER reassigned (not even to the same
 * bd), and the UPDATE re-checks `owner_bd_id IS NULL` in SQL, so an owner set
 * between the read and the write aborts the whole run. --owner must be a row in
 * bd (any role: the owner may be an admin). Bounded: more than 500 companies to
 * assign refuses.
 *
 * HISTORY: one company_property_history row per company, property 'ownerBdId',
 * old value NULL, source 'import' (admin-flavoured, never 'edit').
 *
 * ONE transaction, ONE audit_log row (action 'assign_won_company_owners').
 * REVERT, from that row's metadata.companyKeys: UPDATE company SET
 * owner_bd_id = NULL WHERE company_key IN (...) AND owner_bd_id = <ownerBdId>
 * (a company a BD reassigned since is kept), then DELETE FROM
 * company_property_history WHERE company_key IN (...) AND property = 'ownerBdId'
 * AND source = 'import' AND at >= <audit at>.
 *
 * DRY RUN IS THE DEFAULT (read-only transaction, counts only). Usage (do NOT run
 * --execute without the owner's approval):
 *   npx tsx --env-file=.env.local scripts/assign-won-company-owners.ts --owner=<bd id>
 *   npx tsx --env-file=.env.local scripts/assign-won-company-owners.ts --owner=<bd id> --execute --actor=<bd id>
 *
 * EXIT CODES: 0 success (dry run or write, including "nothing to assign"); 1 bad
 * arguments, unknown owner, over the cap, or any failed check (nothing written).
 */
import { dryRunWonOwners, executeWonOwners } from "../src/lib/wonCompanyOwners/db";
import type { WonOwnerPlan } from "../src/lib/wonCompanyOwners/plan";

function parseArgs(argv: readonly string[]) {
  let owner: string | null = null;
  let execute = false;
  let actor: string | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else if (arg.startsWith("--owner=")) owner = arg.slice("--owner=".length);
    else throw new Error(`Unknown argument: ${arg}. Valid: --owner=<bd id>, --execute, --actor=<bd id>`);
  }
  if (!owner) throw new Error("Usage: assign-won-company-owners.ts --owner=<bd id> [--execute --actor=<bd id>]");
  if (execute && !actor) throw new Error("--execute requires --actor=<bd id> for the audit log.");
  return { owner, execute, actor };
}

const report = (r: WonOwnerPlan["report"]) =>
  [`Won companies: ${r.wonTotal}`, `Already owned (kept): ${r.alreadyOwned}`, `Without owner, to assign: ${r.toAssign}`].join("\n");

async function main() {
  const { owner, execute, actor } = parseArgs(process.argv.slice(2));
  if (!execute) {
    console.log("DRY RUN (read-only transaction)\n");
    console.log(report((await dryRunWonOwners(owner)).report));
    console.log("\nNothing written. Re-run with --execute --actor=<bd id> to apply.");
    return;
  }
  const { plan, auditLogId } = await executeWonOwners(owner, actor!);
  console.log(report(plan.report));
  console.log(auditLogId ? `\nAssigned ${plan.assignments.length} compan(ies). audit_log id: ${auditLogId}` : "\nNothing to assign.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });

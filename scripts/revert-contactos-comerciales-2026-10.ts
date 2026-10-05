/**
 * Guarded revert of scripts/import-contactos-comerciales-2026-10.ts. Reads
 * the import's audit_log row (action 'import_contactos_comerciales_2026_10';
 * latest, or --audit=<id>) and undoes it WITHOUT destroying anyone's work.
 *
 * WHY A SCRIPT AND NOT A DELETE: every table that references person cascades
 * on delete (activity, task, email messages, connections, history, queue...).
 * A plain DELETE would erase the calls and notes Mariel logs on these
 * contacts after the import, and nothing would warn anybody.
 *
 * WHAT IT DELETES: only created contacts that are untouched: no activity,
 * task, email message, signal, scrape job, queue item, connection, id map,
 * duplicate candidate or merge event points at them; they were not merged or
 * merged into; there is no history other than the import's; the owner is still
 * the importer's and the status is still 'new'. Anything else is reported by
 * reason and left alone, never deleted.
 *
 * WHAT IT RESTORES on contacts whose empty phone was filled: phone /
 * mobile_phone back to NULL, only where the value is still the one the import
 * wrote (a number someone edited since is kept), and deletes only the
 * 'import' history rows written by that import (at >= the audit row's time),
 * never older import history. ACCEPTED LOSSES: updated_at / updated_by_bd_id
 * keep the import's values (their previous values were not recorded), and a
 * phone that was '' before the import comes back as NULL.
 *
 * DRY RUN IS THE DEFAULT (READ ONLY transaction, counts only). --execute
 * needs --actor=<bd id>; it runs in ONE transaction under the identity lock,
 * re-plans inside it, and writes ONE audit_log row 'revert_contactos_comerciales_2026_10'.
 *
 * EXIT CODES: 0 success; 1 bad arguments, no audit row, or a failed check
 * (nothing written).
 *
 * Usage (do NOT run --execute automatically):
 *   npx tsx --env-file=.env.local scripts/revert-contactos-comerciales-2026-10.ts [--audit=<id>]
 *   npx tsx --env-file=.env.local scripts/revert-contactos-comerciales-2026-10.ts [--audit=<id>] --execute --actor=<bd id>
 */
import { dryRunRevert, executeRevert } from "../src/lib/contactosComerciales/revertDb";
import type { RevertPlan } from "../src/lib/contactosComerciales/revert";

function parseArgs(argv: readonly string[]) {
  let execute = false;
  let actor: string | null = null;
  let audit: string | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else if (arg.startsWith("--audit=")) audit = arg.slice("--audit=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (execute && !actor) throw new Error("--execute requires --actor=<bd id> for the audit log.");
  return { execute, actor, audit };
}

function report(plan: RevertPlan): string {
  const reasons = new Map<string, number>();
  for (const k of plan.kept) for (const r of k.reasons) reasons.set(r, (reasons.get(r) ?? 0) + 1);
  return [
    `Created contacts to DELETE (untouched): ${plan.deletable.length}`,
    `Created contacts KEPT (someone worked on them): ${plan.kept.length}`,
    ...[...reasons].sort().map(([r, n]) => `    ${r}: ${n}`),
    `Created contacts already gone: ${plan.missing}`,
    `Filled phones to clear: ${plan.clears.reduce((n, c) => n + Number(c.phone) + Number(c.mobilePhone), 0)} column(s) on ${plan.clears.length} contact(s)`,
    `Filled phones changed since (kept): ${plan.changedSince}`,
  ].join("\n");
}

async function main() {
  const { execute, actor, audit } = parseArgs(process.argv.slice(2));
  if (!execute) {
    console.log("DRY RUN (read-only transaction)\n");
    console.log(report(await dryRunRevert(audit)));
    console.log("\nNothing written. Re-run with --execute --actor=<bd id> to apply.");
    return;
  }
  const { plan, auditLogId } = await executeRevert(audit, actor!);
  console.log(report(plan));
  console.log(auditLogId ? `\nReverted. audit_log id: ${auditLogId}` : "\nNothing to revert.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });

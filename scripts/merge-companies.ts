/**
 * Merges CONFIRMED duplicate company records into one surviving record, in ONE transaction, and writes a
 * `company_alias` per merged-away key so the next import resolves to the survivor instead of recreating it.
 *
 * INPUT IS ALWAYS EXPLICIT. Groups come from --group=<survivor_key>:<dead_key>[,<dead_key>...] (repeatable) or
 * --file=<path> (one such line per row; blanks and # comments skipped), or --json=<path> holding
 * [{"survivor": "<key>", "dead": ["<key>", ...]}]. JSON is the way to merge a key containing ':' (which
 * normalizeCompanyKey keeps, e.g. "quares :: it solutions") since the line format uses ':' as its separator;
 * it cannot be combined with --group/--file. The squash heuristic is used ONLY by
 * --report to PROPOSE candidates; `&company` and `Company` squash alike and are different companies, so it must
 * never decide a merge. Keys are `company.company_key` values, matched exactly.
 *
 * FIELD RULES (src/lib/companyMerge/plan.ts)
 *   - relationship_stage: the strongest fact wins, whichever record survives: won > proposal_sent > qualified >
 *     prospect > lost. A `won` is never lost to a merge.
 *   - Every other field (domain, industry, owner, city, country, notes, account type, client status, revenue,
 *     LinkedIn): fill-empty only. The survivor keeps what it has; a dead record only fills a blank.
 *   - When both hold DIFFERENT non-empty values the survivor's is kept and the discarded value is counted per field
 *     in the output and recorded in the audit row (notes: counted only, the text is never copied).
 *   - Each filled/promoted field gets a company_property_history row, source 'merge'. display_name is never
 *     changed; the merged-away names stay in the audit row and resolve through the alias.
 *
 * WHAT MOVES: all 14 tables with a company_key (the per-table collision handling is documented in
 * src/lib/companyMerge/db.ts). person/contact/lead rows keep their own free-text `company` name; only the key moves.
 * Two persons who now share a company and a name will surface in /admin/duplicates, nothing is auto-merged.
 *
 * REQUIRES migration 0039 (moves company_alias's FK from target_company to company) unless the survivor or a dead record is a
 * target company. The dry run reports it as a blocker; execute refuses.
 *
 * NOT REVERSIBLE. Once keys are repointed there is no per-row undo and none is provided. The one audit_log row
 * (action 'merge_companies') carries what a manual reconstruction needs: per table, the ids moved from each dead
 * key (`movedIds`), the dead company rows (minus notes), the dead target_company rows, the discarded values, the
 * aliases written. Take a backup (src/lib/migration/backup.ts#snapshotBackup) before --execute.
 *
 * PROPOSALS (migration 0040): a BD may propose "company X was absorbed by Y" (company_absorption_proposal). The dry run
 * REPORTS which open proposals the groups fulfil and which they contradict; --execute marks the fulfilled ones 'applied'
 * in the same transaction (before the dead company rows go) and records both lists in the audit row. A proposal is a
 * suggestion: it never adds, removes or alters a group, so each group is still confirmed by hand. A proposal the groups
 * contradict is NOT marked applied and is only reported (one whose survivor is merged away is removed by the FK cascade
 * when that company is deleted). Without migration 0040 the merge works and simply reports none.
 *
 * Bounded: at most 100 groups and 20,000 moved rows per run. Counts and company names only, never a person.
 *
 * DRY RUN IS THE DEFAULT (read-only transaction). Usage (do NOT run --execute without the owner's approval):
 *   npx tsx --env-file=.env.local scripts/merge-companies.ts --report [--match=<text>]
 *   npx tsx --env-file=.env.local scripts/merge-companies.ts --group=<survivor>:<dead>[,<dead>] [--file=groups.txt]
 *   npx tsx --env-file=.env.local scripts/merge-companies.ts --json=groups.json
 *   npx tsx --env-file=.env.local scripts/merge-companies.ts --group=... --execute --actor=<bd id>
 *
 * EXIT CODES: 0 success (dry run, report or write); 1 bad arguments, a blocker, or any failed check (nothing written).
 */
import { readFileSync } from "node:fs";
import { dryRunMerge, executeMerge, readCandidateRecords } from "../src/lib/companyMerge/db";
import { groupCandidates, parseGroupJson, parseGroupLines } from "../src/lib/companyMerge/plan";

function parseArgs(argv: readonly string[]) {
  const o = { execute: false, report: false, actor: null as string | null, match: null as string | null, lines: [] as string[], json: null as string | null };
  for (const a of argv) {
    if (a === "--execute") o.execute = true;
    else if (a === "--report") o.report = true;
    else if (a.startsWith("--actor=")) o.actor = a.slice(8);
    else if (a.startsWith("--match=")) o.match = a.slice(8);
    else if (a.startsWith("--group=")) o.lines.push(a.slice(8));
    else if (a.startsWith("--json=")) {
      if (o.json) throw new Error("Pass --json once.");
      o.json = a.slice(7);
    } else if (a.startsWith("--file=")) o.lines.push(...readFileSync(a.slice(7), "utf8").split("\n"));
    else throw new Error(`Unknown argument: ${a}. Valid: --report, --match=<text>, --group=<survivor>:<dead>[,<dead>], --file=<path>, --json=<path>, --execute, --actor=<bd id>`);
  }
  if (o.json && o.lines.length) throw new Error("--json cannot be combined with --group or --file: pick one input.");
  if (o.execute && !o.actor) throw new Error("--execute requires --actor=<bd id> for the audit log.");
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.report) {
    const groups = groupCandidates(await readCandidateRecords(o.match));
    console.log(`${groups.length} candidate group(s) by squashed key. A HEURISTIC: confirm each by hand before it goes in a --file.\n`);
    for (const g of groups) {
      console.log(`${g.squash}  (${g.records.length} records, ${g.contacts} contacts)`);
      for (const r of g.records) console.log(`  ${r.companyKey} | ${r.displayName} | stage=${r.stage ?? "-"} | contacts=${r.contacts} | domain=${r.domain ?? "-"}`);
      console.log(`  # unconfirmed: ${g.records[0]!.companyKey}:${g.records.slice(1).map((r) => r.companyKey).join(",")}\n`);
    }
    return;
  }
  const groups = o.json ? parseGroupJson(readFileSync(o.json, "utf8")) : parseGroupLines(o.lines);
  if (o.execute) {
    const r = await executeMerge(groups, o.actor!);
    console.log(`Merged ${r.plans.length} group(s). Rows repointed per table:`, r.moved, `\nProposals marked applied: ${r.proposals.matched.length} | contradicted, not marked: ${r.proposals.divergent.length}\naudit_log id: ${r.auditLogId}`);
    return;
  }
  const r = await dryRunMerge(groups);
  console.log("DRY RUN (read-only transaction)\n");
  for (const p of r.plans) {
    const names = p.deadKeys.map((k) => p.displayNames[k]).join(" + ");
    console.log(`${p.displayNames[p.survivorKey]} <- ${names}`);
    console.log(`  stage after merge: ${p.merged.relationshipStage ?? "-"} | fields filled: ${p.changes.map((c) => c.field).join(", ") || "none"}`);
    console.log(`  discarded differing values: ${p.discarded.length}${p.discarded.length ? ` (${[...new Set(p.discarded.map((d) => d.field))].join(", ")})` : ""}`);
  }
  console.log("\nRows that would move to the surviving key, per table:", r.moved);
  console.log(`Duplicate job postings dropped: ${r.duplicatePostings} | duplicate probe rows dropped: ${r.duplicateProbes} | target companies created for a survivor: ${r.targetsToCreate.length}`);
  if (r.proposals.tableMissing) console.log("\nProposals: table company_absorption_proposal not found (migration 0040 not applied); none reported.");
  else console.log(`\nProposals: ${r.proposals.matched.length} open proposal(s) match these groups and would be marked applied; ${r.proposals.divergent.length} open proposal(s) are contradicted by them and would NOT be marked.`);
  for (const m of r.proposals.matched) console.log(`  matches: ${m.id} | ${m.absorbedKey} -> ${m.survivorKey}`);
  for (const d of r.proposals.divergent) console.log(`  CONTRADICTED (${d.reason}): ${d.id} | ${d.absorbedKey} -> ${d.survivorKey}`);
  if (r.blockers.length) console.log(`\nBLOCKED, --execute would refuse:\n- ${r.blockers.join("\n- ")}`);
  console.log("\nNothing written. Re-run with --execute --actor=<bd id> to apply.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });

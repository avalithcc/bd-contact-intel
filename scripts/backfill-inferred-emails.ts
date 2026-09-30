/**
 * One-off, owner-gated backfill (owner decision 2026-09-30,
 * `openspec/decisions/2026-09-30-decision-brief.md` "3. Email enrichment —
 * stage 1 decided"): infers a missing `person.email` from the dominant
 * email-address convention already observed among a candidate's own company
 * colleagues — for free, no Hunter/DNS call. Refuses rather than guesses —
 * see src/lib/identity/emailPatternInferenceBackfill.ts for the exact rule
 * (80%-of-known-emails pattern agreement, particle/compound-surname skip,
 * personal-mail domain exclusion, every skip reason).
 *
 * Never treated as verified: writes `email_status = 'probable'` (the
 * existing "unverified" vocabulary) with `email_source = 'pattern_inferred'`
 * — a NEW email_source value, never `'verified'`. The record page renders
 * "Inferido" for it (see PropertyList.tsx/AboutPane.tsx's `emailInferred`
 * prop, wired through src/app/(app)/contacts/[id]/page.tsx).
 *
 * Collisions (contact-identity spirit: a wrong email is worse than a missing
 * one) are measured, never silently applied:
 *   - two candidates in the SAME run whose inferred address would collide
 *     with EACH OTHER are both skipped ("in_run_collision" —
 *     dedupeInRunCollisions in the pure planner);
 *   - a candidate whose inferred address already belongs to an EXISTING
 *     non-merged person is skipped ("db_collision" — filterExistingCollisions,
 *     backed by one indexed round trip via `person_email_normalized_idx`).
 * Neither case auto-merges or overwrites anything — both are just counted,
 * exactly like the owner ask: "it may be a duplicate person."
 *
 * `--apply` hardening (same shape as scripts/backfill-person-names-from-email.ts
 * and src/lib/emailVerification/hubspotImportVerifiedQueries.ts):
 *   1. All or nothing — the batched person UPDATE, the batched
 *      `person_property_history` insert, and the `audit_log` insert all run
 *      inside ONE `db.transaction`. The UPDATE is one bulk
 *      `UPDATE ... FROM (VALUES ...)` statement, never one round trip per
 *      row (700+ candidates over a ~222ms link would otherwise take minutes).
 *   2. Audit trail — one `audit_log` row (action
 *      `email_pattern_inference_backfill`), ONLY when at least one fill was
 *      applied (a no-op re-run must never write an empty audit row — see
 *      isEmailPatternInferenceBackfillAuditWorthRecording).
 *   3. Re-check before writing — the UPDATE's WHERE clause re-checks
 *      `email IS NULL` at write time. A row filled by something else since
 *      the dry run is skipped, not overwritten, and reported as
 *      `skippedRacePersonIds`.
 *   4. Idempotent — a second run finds zero candidates with `email IS NULL`
 *      among the ones this run just filled, so it writes 0 rows.
 *
 * Revert: documented, not automated (rule 4, "a documented revert path") —
 * see emailPatternInferenceBackfillAudit.ts's `revertNote` (written into the
 * audit_log row itself). `email_source = 'pattern_inferred'` is the anchor,
 * not the applied-ids list: once applied, a row's `email` is no longer null,
 * so this script's OWN dry run can never re-derive a truncated id list — the
 * revert must not depend on it. `email_source = 'pattern_inferred'` alone
 * uniquely identifies every row this backfill (and only this backfill) ever
 * wrote, and safely leaves alone any row a BD has since hand-edited
 * (email_source would have moved to `'manual'`).
 *
 * Defaults to `--dry-run` (no writes) and REQUIRES `--apply --actor=<bd id>`
 * to actually write. Requires DATABASE_URL to be set (see .env).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-inferred-emails.ts                        # dry run (default)
 *   npx tsx --env-file=.env.local scripts/backfill-inferred-emails.ts --apply --actor=<bd id> # writes
 */
import {
  buildEmailPatternInferencePlan,
  filterExistingCollisions,
  type InferenceSkipReason,
} from "@/lib/identity/emailPatternInferenceBackfill";
import {
  buildInferenceCandidates,
  executeEmailPatternInferenceBackfill,
  readCandidates,
  readColleagueEmails,
  readCompanyDomains,
  readExistingEmailNormalized,
} from "@/lib/identity/emailPatternInferenceBackfillDb";

interface Args {
  apply: boolean;
  actor: string | null;
}

function parseArgs(argv: readonly string[]): Args {
  let apply = false;
  let actor: string | null = null;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") apply = false;
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else throw new Error(`Unknown argument: ${arg}. Valid: --apply, --dry-run, --actor=<bd id>`);
  }
  return { apply, actor };
}

const SKIP_REASON_ORDER: InferenceSkipReason[] = [
  "missing_name",
  "multi_token_first_name",
  "multi_token_surname",
  "normalized_name_empty",
  "no_domain",
  "personal_domain",
  "no_dominant_pattern",
  "in_run_collision",
  "db_collision",
];

const SAMPLE_SIZE = 30;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.apply && !args.actor) {
    throw new Error("--apply requires --actor=<bd id> for the audit log");
  }

  const candidateRows = await readCandidates();
  console.log(`Candidates read (non-merged, email IS NULL, has a company_key): ${candidateRows.length}`);

  const companyKeys = [...new Set(candidateRows.map((c) => c.companyKey))];
  const [companyDomains, colleagueEmails] = await Promise.all([
    readCompanyDomains(companyKeys),
    readColleagueEmails(companyKeys),
  ]);

  const candidates = buildInferenceCandidates(candidateRows, companyDomains, colleagueEmails);
  const rawPlan = buildEmailPatternInferencePlan(candidates);

  const existingNormalized = await readExistingEmailNormalized(rawPlan.fills.map((f) => f.emailNormalized));
  const plan = filterExistingCollisions(rawPlan, existingNormalized);

  const domainCount = new Set(plan.fills.map((f) => f.domain)).size;
  console.log(`Fills found: ${plan.fills.length} (across ${domainCount} distinct domains)`);
  console.log(`Skips found: ${plan.skips.length}`);
  console.log("Skip totals by reason:");
  const skipsByReason = new Map<InferenceSkipReason, number>();
  for (const skip of plan.skips) skipsByReason.set(skip.reason, (skipsByReason.get(skip.reason) ?? 0) + 1);
  for (const reason of SKIP_REASON_ORDER) {
    const count = skipsByReason.get(reason) ?? 0;
    if (count > 0) console.log(`  ${reason}: ${count}`);
  }

  console.log("");
  console.log(`Sample of up to ${SAMPLE_SIZE} inferred emails (pattern, matched/total):`);
  for (const fill of plan.fills.slice(0, SAMPLE_SIZE)) {
    console.log(`  ${fill.email} <- ${fill.firstName} ${fill.lastName} @ ${fill.companyKey} ` +
      `[${fill.patternId}, ${fill.matched}/${fill.total}]`);
  }

  if (!args.apply) {
    console.log("");
    console.log("Dry run only — no writes performed. Re-run with --apply --actor=<bd id> to write.");
    return;
  }

  const result = await executeEmailPatternInferenceBackfill(plan.fills, args.actor!);

  console.log("");
  console.log(`Applied ${result.appliedPersonIds.length} inferred email(s).`);
  if (result.skippedRacePersonIds.length) {
    console.log(
      `${result.skippedRacePersonIds.length} planned fill(s) were skipped — the person's email was no longer ` +
        "null at write time (see audit_log for the exact set).",
    );
  }
  if (result.appliedPersonIds.length === 0) {
    console.log("Nothing to do — no audit_log row written.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

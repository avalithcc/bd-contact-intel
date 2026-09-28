/**
 * One-off, owner-gated correction (production count checked 2026-09-28):
 * relabels `person.email_status` from `'probable'` to `'verified'` for
 * every row whose email came from the HubSpot export
 * (`person.email_source = 'hubspot_import'`, measured at 5,076 rows). The
 * owner confirmed those addresses were already checked on HubSpot's side
 * before the export — `'probable'` is wrong for them: a future "verified"
 * filter would wrongly exclude them, and the record page's Verified badge
 * understates confidence the owner already has.
 *
 * Scope is `person.email_source`, deliberately NOT `person.source_key` —
 * see the header of src/lib/emailVerification/hubspotImportVerifiedBackfill.ts
 * for why those two columns answer different questions and can disagree.
 * This script's dry run prints, per `email_source` group among currently-
 * `'probable'` rows, how many rows have a `source_key` that disagrees with
 * `'hubspot_import'` — so that disagreement is visible before the write,
 * not discovered after.
 *
 * `email_confidence` is left untouched (stays whatever it already is —
 * `null` for hubspot_import rows today). See the same header comment for
 * why a `'verified'` status next to a `null` confidence is not a new or
 * contradictory combination in this data.
 *
 * Every OTHER `email_source` currently at `'probable'`
 * (`fi-arg-2026-mails-probables`, `fi-arg-2026-mails-hunter`, `null`,
 * `correos_final`, and any other) is left exactly as-is — those are
 * genuinely uncertain per the owner, not part of this correction.
 *
 * `lead.email_status` has no analogous situation: the HubSpot import phase
 * (src/lib/hubspot/planner.ts, src/lib/hubspot/identity.ts) only ever
 * writes to `person`, never to `lead` — `lead` rows come exclusively from
 * the CSV event-attendee ingest (src/lib/leads/csv.ts), so no `lead` row
 * can carry `email_source = 'hubspot_import'`.
 *
 * `--execute` hardening, matching scripts/backfill-company-domains.ts and
 * scripts/backfill-company-account-type.ts:
 *   1. All or nothing — the `UPDATE`, the batched `person_property_history`
 *      insert and the `audit_log` insert all run inside ONE
 *      `db.transaction` (src/lib/emailVerification/hubspotImportVerifiedQueries.ts).
 *   2. Audit trail — one `audit_log` row (action
 *      `hubspot_email_verified_backfill`) in the SAME transaction, holding
 *      the predicate, the updated count, and the updated person ids
 *      (capped at 1000 — see HUBSPOT_EMAIL_VERIFIED_BACKFILL_AUDIT_ID_CAP).
 *      Person ids are not PII in the sense this repo cares about for audit
 *      rows (same treatment as company keys in the sibling scripts) and are
 *      exactly what a revert needs.
 *   3. A `person_property_history` row is written for every updated person
 *      (property `emailStatus`, old value always `'probable'` — guaranteed
 *      by the `UPDATE`'s own `WHERE` clause, so no extra read is needed to
 *      know it), so the record page's history tab shows why the status
 *      changed.
 *
 * A pg_dump backup is NOT strictly required: this only ever moves
 * `email_status` from `'probable'` to `'verified'` on rows matching the
 * exact predicate above; `email_confidence`/`email_source`/every other
 * column is untouched. To revert a completed `--execute` run, read the
 * `audit_log` row's metadata (`action = 'hubspot_email_verified_backfill'`)
 * and run:
 *   update person set email_status = 'probable' where id in (<updatedPersonIds>);
 * (if `updatedPersonIdsTruncated` is true, the capped list is incomplete —
 * re-run this script's dry run against the same DB state and diff against
 * the audit row's `updatedCount` instead of relying on the capped list.)
 *
 * Defaults to `--dry-run` (no writes) and REQUIRES `--execute
 * --actor=<bd id>` to actually write. Requires DATABASE_URL to be set (see
 * .env). Never prints the connection string or any row's email address.
 *
 * Usage:
 *   npx tsx scripts/backfill-hubspot-email-verified.ts                          # dry run (default)
 *   npx tsx scripts/backfill-hubspot-email-verified.ts --execute --actor=<bd id> # writes
 */
import {
  HUBSPOT_IMPORT_EMAIL_SOURCE,
  isHubspotImportProbableEmail,
} from "../src/lib/emailVerification/hubspotImportVerifiedBackfill";
import {
  executeHubspotEmailVerifiedBackfill,
  readProbableEmailSourceBreakdown,
} from "../src/lib/emailVerification/hubspotImportVerifiedQueries";

interface Args {
  execute: boolean;
  actor: string | null;
}

function parseArgs(argv: readonly string[]): Args {
  let execute = false;
  let actor: string | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg === "--dry-run") execute = false; // explicit no-op, dry-run is already the default
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
  }
  return { execute, actor };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.execute && !args.actor) {
    throw new Error("--execute requires --actor=<bd id> for the audit log");
  }

  const breakdown = await readProbableEmailSourceBreakdown();
  const total = breakdown.reduce((sum, b) => sum + b.count, 0);
  const hubspotGroup = breakdown.find((b) => b.emailSource === HUBSPOT_IMPORT_EMAIL_SOURCE) ?? null;
  const toVerify = hubspotGroup?.count ?? 0;

  console.log(`person rows currently email_status = 'probable': ${total}`);
  console.log("Breakdown by email_source:");
  for (const b of breakdown.sort((a, b2) => b2.count - a.count)) {
    const label = b.emailSource ?? "(null)";
    console.log(`  - ${label}: ${b.count}`);
  }

  console.log(`\nScoped to relabel (email_source = '${HUBSPOT_IMPORT_EMAIL_SOURCE}'): ${toVerify}`);
  if (hubspotGroup && hubspotGroup.sourceKeyDisagreeing > 0) {
    console.log(
      `  WARNING: ${hubspotGroup.sourceKeyDisagreeing} of those ${toVerify} row(s) have a person.source_key ` +
        `other than '${HUBSPOT_IMPORT_EMAIL_SOURCE}' — expected (source_key tracks the CONTACT's provenance, ` +
        `not the email's), still in scope for this correction since email_source is what's being read.`,
    );
  } else if (hubspotGroup) {
    console.log("  source_key agrees with email_source on every one of these rows.");
  }

  const staysProbable = total - toVerify;
  console.log(`Stays 'probable' (out of scope, genuinely uncertain per the owner): ${staysProbable}`);

  // Sanity-check the predicate exported for testing against this same
  // breakdown, so a drift between the pure predicate and the SQL WHERE
  // clause fails loudly here instead of silently diverging.
  const predicateToVerify = breakdown
    .filter((b) => isHubspotImportProbableEmail({ emailStatus: "probable", emailSource: b.emailSource }))
    .reduce((sum, b) => sum + b.count, 0);
  if (predicateToVerify !== toVerify) {
    throw new Error(
      `Predicate/query drift: isHubspotImportProbableEmail selects ${predicateToVerify} but the SQL breakdown reports ${toVerify}`,
    );
  }

  if (!args.execute) {
    console.log("\nDry run only — no writes performed. Re-run with --execute --actor=<bd id> to apply.");
    return;
  }

  const result = await executeHubspotEmailVerifiedBackfill(args.actor!);
  console.log(`\nUpdated ${result.updatedPersonIds.length} person row(s) to email_status = 'verified'.`);
  if (result.updatedPersonIds.length !== toVerify) {
    console.log(
      `NOTE: updated count (${result.updatedPersonIds.length}) differs from the dry-run count (${toVerify}) — ` +
        "the underlying data changed between the read above and the write (e.g. a concurrent edit). This is " +
        "expected under concurrent writes, not a bug; the audit_log row records exactly what happened.",
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

/**
 * One-off, owner-gated backfill: splits the REMAINING stuffed
 * `person.first_name` values that scripts/backfill-split-stuffed-names.ts
 * (PR #186, audit row df7a98fe) deliberately refused rather than guess at —
 * about 36 rows still have a full name in `first_name` with `last_name`
 * left empty. Uses the simpler, owner-approved rule from 2026-09-30 (see
 * src/lib/identity/stuffedNameFirstTokenSplit.ts for the exact rule and why
 * it is a SEPARATE, simpler rule from stuffedNameSplitBackfill.ts's
 * particle-aware one):
 *   1. First word is the first name, everything after is the last name.
 *   2. A middle initial right after the first word stays with the first
 *      name.
 *   3. Anything after a comma (a credential/title) is dropped.
 *   4. A value that becomes a single token after trimming is not split —
 *      reported in a "needs review" section instead.
 *   5. A 2-token value whose 2nd token is a bare initial is not split
 *      either (never fabricates a one-letter last name).
 *   6. A common Spanish/Portuguese given name as the 2nd token stays with
 *      the first name too ("Maria Sol Gonzalez" -> "Maria Sol" / "Gonzalez"
 *      — see commonGivenNames.ts).
 *   7. A confirmed "<Name>Ver el perfil de <Name>" LinkedIn scrape artifact
 *      is cleaned (suffix stripped) and split directly, BYPASSING the
 *      safety gate below entirely.
 *   8. A short, explicit, hand-verified, person-id-keyed list of manual
 *      overrides (stuffedNameFirstTokenSplitOverrides.ts) takes priority
 *      over everything else — one of them also creates and links a brand
 *      new `company` row in the SAME transaction (see the company-creation
 *      handling below).
 *
 * SAFETY GATE (review fix, CRITICAL): every OTHER candidate is re-classified with
 * the EXISTING, more conservative classifier (stuffedNameSplitBackfill.ts's
 * deriveStuffedNameSplit) before this simpler rule is allowed to touch it —
 * see stuffedNameFirstTokenSplit.ts#classifyForFirstTokenSplit. Only rows the
 * original rule itself calls "ambiguous_3"/"ambiguous_many" are split here;
 * company names, junk, particle-first data, and rows the original rule can
 * already resolve are routed to "needs review", UNSPLIT, labelled with the
 * gate's reason.
 *
 * Reads the exact same candidate set as scripts/backfill-split-stuffed-
 * names.ts (readStuffedNameSplitCandidates: non-merged, first_name has
 * whitespace, last_name empty) — reused as-is rather than duplicating the
 * query, since the precondition is identical; only the SPLITTING rule
 * differs. Naturally idempotent: once a row is split, it no longer matches
 * that precondition and drops out of future candidate reads.
 *
 * `--execute` hardening (same shape as scripts/backfill-split-stuffed-names.ts):
 *   1. All or nothing — the batched name UPDATE and the `audit_log` INSERT
 *      run inside ONE `db.transaction`, one bulk `UPDATE ... FROM (VALUES ...)`
 *      statement, never one round trip per row.
 *   2. Audit trail — one `audit_log` row (action
 *      `person_first_token_split_backfill`), ONLY when at least one fill was
 *      applied. Metadata carries each applied fill's personId, the exact
 *      firstName/lastName written, AND the exact original (pre-backfill)
 *      firstName/lastName — the revert path needs the original values.
 *   3. Re-check before writing — the UPDATE's WHERE clause re-checks that
 *      first_name still equals exactly what was read AND last_name is still
 *      empty, at write time. A row that changed since the dry run is
 *      skipped, not overwritten, and reported as `fillsSkippedRace`.
 *   4. Cap refusal (review fix) — if the plan has more fills than
 *      FIRST_TOKEN_SPLIT_AUDIT_CAP, `--execute` REFUSES outright rather than
 *      silently truncating the audit metadata (a truncated audit row could
 *      never fully `--revert`). Split the run into smaller batches instead.
 *
 * Revert: `--revert` (dry run) or `--revert --execute --actor=<bd id>`
 * (applies) — reuses the fully generic revert selection/plan from
 * src/lib/identity/stuffedNameSplitBackfillRevert.ts (same "never just
 * latest, refuse when several exist" rule), scoped to THIS backfill's own
 * `person_first_token_split_backfill` audit_log action so it can never be
 * confused with or revert PR #186's separate audit trail.
 *
 * Defaults to `--dry-run` (no writes) and REQUIRES `--execute --actor=<bd
 * id>` to actually write. Requires DATABASE_URL to be set (see .env).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-split-remaining-stuffed-names.ts                          # dry run (default)
 *   npx tsx --env-file=.env.local scripts/backfill-split-remaining-stuffed-names.ts --execute --actor=<bd id> # writes
 *   npx tsx --env-file=.env.local scripts/backfill-split-remaining-stuffed-names.ts --revert                  # revert dry run
 *   npx tsx --env-file=.env.local scripts/backfill-split-remaining-stuffed-names.ts --revert --execute --actor=<bd id>
 *   npx tsx --env-file=.env.local scripts/backfill-split-remaining-stuffed-names.ts --revert --audit-id=<uuid> [--execute --actor=<bd id>]
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog, company, person, personPropertyHistory } from "../src/db/schema";
import { normalizeCompanyKey } from "../src/lib/companyCategories";
import {
  buildFirstTokenSplitPlan,
  type FirstTokenSplitRule,
  type FirstTokenSplitSkipReason,
} from "../src/lib/identity/stuffedNameFirstTokenSplit";
import {
  buildFirstTokenSplitAuditMetadata,
  FIRST_TOKEN_SPLIT_AUDIT_CAP,
  isFirstTokenSplitAuditWorthRecording,
  type AppliedFirstTokenSplit,
} from "../src/lib/identity/stuffedNameFirstTokenSplitAudit";
import {
  FIRST_TOKEN_SPLIT_BACKFILL_ACTION,
  FIRST_TOKEN_SPLIT_REVERT_ACTION,
  readAllFirstTokenSplitAuditRows,
} from "../src/lib/identity/stuffedNameFirstTokenSplitBackfillRevertDb";
import {
  buildFirstTokenSplitCompanyLinkHistoryRows,
  buildFirstTokenSplitNameHistoryRows,
} from "../src/lib/identity/stuffedNameFirstTokenSplitHistory";
import { readStuffedNameSplitCandidates } from "../src/lib/identity/stuffedNameSplitBackfillDb";
import {
  buildStuffedNameSplitRevertPlan,
  selectStuffedNameSplitAuditRow,
} from "../src/lib/identity/stuffedNameSplitBackfillRevert";
import { readCurrentPersonsByIds } from "../src/lib/identity/stuffedNameSplitBackfillRevertDb";

interface Args {
  execute: boolean;
  actor: string | null;
  revert: boolean;
  auditId: string | null;
}

function parseArgs(argv: readonly string[]): Args {
  let execute = false;
  let actor: string | null = null;
  let revert = false;
  let auditId: string | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg === "--dry-run") execute = false;
    else if (arg === "--revert") revert = true;
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else if (arg.startsWith("--audit-id=")) auditId = arg.slice("--audit-id=".length);
    else {
      throw new Error(
        `Unknown argument: ${arg}. Valid: --execute, --dry-run, --revert, --actor=<bd id>, --audit-id=<uuid>`,
      );
    }
  }
  return { execute, actor, revert, auditId };
}

const RULE_ORDER: FirstTokenSplitRule[] = ["plain", "middle_initial", "compound_given_name", "manual_override"];

// Ineligible/gate reasons first (most common in practice — the vast
// majority of what remains after PR #186 is exactly this), then this
// module's own post-gate skip reasons.
const SKIP_REASON_ORDER: FirstTokenSplitSkipReason[] = [
  "looks_like_company",
  "junk_digit",
  "junk_at",
  "junk_punctuation",
  "junk_scrape_artifact",
  "particle_first",
  "owner_excluded",
  "resolvable_by_original_rule",
  "single_token",
  "bare_initial_last_name",
];

async function runForwardBackfill(args: Args) {
  const candidates = await readStuffedNameSplitCandidates();
  const plan = buildFirstTokenSplitPlan(candidates);

  console.log(`Candidates read (non-merged, first_name has whitespace, last_name empty): ${candidates.length}`);
  console.log(`Fills found (gate-eligible: ambiguous_3/ambiguous_many only): ${plan.fills.length}`);
  console.log(`Needs-review (gate-ineligible or still-ambiguous) found: ${plan.skips.length}`);

  const fillsByRule = new Map<FirstTokenSplitRule, typeof plan.fills>();
  for (const fill of plan.fills) {
    const list = fillsByRule.get(fill.rule) ?? [];
    list.push(fill);
    fillsByRule.set(fill.rule, list);
  }
  console.log("");
  console.log(`Every proposed split (${plan.fills.length}), grouped by rule:`);
  for (const rule of RULE_ORDER) {
    const list = fillsByRule.get(rule) ?? [];
    if (list.length === 0) continue;
    console.log(`  ${rule} (${list.length}):`);
    for (const fill of list) {
      console.log(`    "${fill.originalFirstName}" -> "${fill.firstName}" / "${fill.lastName}"`);
    }
  }

  const skipsByReason = new Map<FirstTokenSplitSkipReason, typeof plan.skips>();
  for (const skip of plan.skips) {
    const list = skipsByReason.get(skip.reason) ?? [];
    list.push(skip);
    skipsByReason.set(skip.reason, list);
  }
  console.log("");
  console.log(`Needs review — not split (${plan.skips.length}), grouped by reason:`);
  for (const reason of SKIP_REASON_ORDER) {
    const list = skipsByReason.get(reason) ?? [];
    if (list.length === 0) continue;
    console.log(`  ${reason} (${list.length}):`);
    for (const skip of list) {
      const flags = [
        skip.isDigitsOnly ? "digits" : null,
        skip.isCommonNonPersonWord ? "common non-person word" : null,
      ].filter((f): f is string => f !== null);
      const flagText = flags.length ? ` [${flags.join(", ")}]` : "";
      console.log(`    ${skip.personId}: "${skip.originalFirstName}"${flagText}`);
    }
  }

  if (!args.execute) {
    console.log("");
    console.log("Dry run only — no writes performed. Re-run with --execute --actor=<bd id> to apply.");
    if (plan.fills.length > FIRST_TOKEN_SPLIT_AUDIT_CAP) {
      console.log(
        `WARNING: ${plan.fills.length} planned fill(s) exceed the ${FIRST_TOKEN_SPLIT_AUDIT_CAP}-row audit cap — ` +
          "--execute will REFUSE until this run is split into smaller batches.",
      );
    }
    return;
  }

  if (plan.fills.length > FIRST_TOKEN_SPLIT_AUDIT_CAP) {
    throw new Error(
      `Refusing to execute: ${plan.fills.length} planned fill(s) exceed the ${FIRST_TOKEN_SPLIT_AUDIT_CAP}-row ` +
        "audit cap — no writes performed. Split this run into smaller batches instead.",
    );
  }

  const appliedFills: AppliedFirstTokenSplit[] = [];
  const skippedRacePersonIds: string[] = [];
  const companyLinkSkippedPersonIds: string[] = [];

  await db.transaction(async (tx) => {
    if (plan.fills.length > 0) {
      const values = plan.fills.map(
        (fill) =>
          sql`(${fill.personId}::uuid, ${fill.firstName}::text, ${fill.lastName}::text, ${fill.originalFirstName}::text)`,
      );
      const updatedRows = (await tx.execute(sql`
        UPDATE person AS p
        SET first_name = v.first_name,
            last_name = v.last_name,
            updated_at = now()
        FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, first_name, last_name, original_first_name)
        WHERE p.id = v.id
          AND p.first_name = v.original_first_name
          AND (p.last_name IS NULL OR btrim(p.last_name) = '')
        RETURNING p.id
      `)) as unknown as { id: string }[];

      const updatedIds = new Set(updatedRows.map((r) => r.id));
      for (const fill of plan.fills) {
        if (updatedIds.has(fill.personId)) {
          appliedFills.push({
            personId: fill.personId,
            firstName: fill.firstName,
            lastName: fill.lastName,
            originalFirstName: fill.originalFirstName,
            originalLastName: fill.originalLastName,
            rule: fill.rule,
          });
        } else {
          skippedRacePersonIds.push(fill.personId);
        }
      }
    }

    // person_property_history — one row per CHANGED field only (owner ask:
    // "every override and fill writes the same audit and history rows as
    // the rest").
    const nameHistoryRows = appliedFills.flatMap((fill) => buildFirstTokenSplitNameHistoryRows(fill));
    if (nameHistoryRows.length) await tx.insert(personPropertyHistory).values(nameHistoryRows);

    // Company creation + link — ONLY for the "Smart Gen" manual override
    // (createCompany set on its plan.fills entry). Kept as a small,
    // separate single-row update (not folded into the batched name UPDATE
    // above) so it can never accidentally overwrite another person's
    // company/companyKey with a stale dry-run-time read.
    const createCompanyByPersonId = new Map(
      plan.fills.filter((f) => f.createCompany).map((f) => [f.personId, f.createCompany!] as const),
    );
    for (const fill of appliedFills) {
      const createCompany = createCompanyByPersonId.get(fill.personId);
      if (!createCompany) continue;

      const companyKey = normalizeCompanyKey(createCompany.displayName);
      const [existing] = await tx.select({ companyKey: company.companyKey }).from(company).where(eq(company.companyKey, companyKey));
      if (!existing) {
        await tx.insert(company).values({
          companyKey,
          displayName: createCompany.displayName,
          relationshipStage: "prospect",
          createdByBdId: args.actor,
          updatedByBdId: args.actor,
        });
      }

      // Re-check preconditions at write time (task ask: "no company") — a
      // BD who assigned this person a company between dry run and execute
      // is never silently overwritten.
      const [linked] = await tx
        .update(person)
        .set({ company: createCompany.displayName, companyKey, updatedAt: new Date(), updatedByBdId: args.actor })
        .where(and(eq(person.id, fill.personId), isNull(person.company), isNull(person.companyKey)))
        .returning({ id: person.id });

      if (linked) {
        fill.linkedCompany = { companyKey, displayName: createCompany.displayName, createdNewCompany: !existing };
        await tx
          .insert(personPropertyHistory)
          .values(buildFirstTokenSplitCompanyLinkHistoryRows({ personId: fill.personId, displayName: createCompany.displayName, companyKey }));
      } else {
        companyLinkSkippedPersonIds.push(fill.personId);
      }
    }

    if (!isFirstTokenSplitAuditWorthRecording({ appliedFills })) return;

    const metadata = buildFirstTokenSplitAuditMetadata({
      fillsPlanned: plan.fills.length,
      appliedFills,
      skippedRacePersonIds,
    });
    await tx.insert(auditLog).values({
      actorBdId: args.actor!,
      action: FIRST_TOKEN_SPLIT_BACKFILL_ACTION,
      metadata,
    });
  });

  if (!isFirstTokenSplitAuditWorthRecording({ appliedFills })) {
    console.log("");
    console.log("Nothing to do — no fills applied. No audit_log row written.");
    return;
  }

  console.log("");
  console.log(`Applied ${appliedFills.length} name split(s).`);
  if (skippedRacePersonIds.length) {
    console.log(
      `${skippedRacePersonIds.length} planned fill(s) were skipped — the person's row changed since the dry ` +
        "run (see audit_log for the exact set).",
    );
  }
  if (companyLinkSkippedPersonIds.length) {
    console.log(
      `${companyLinkSkippedPersonIds.length} company link(s) were skipped — the person already had a company ` +
        `assigned by the time of the write: ${companyLinkSkippedPersonIds.join(", ")}`,
    );
  }
  if (appliedFills.length !== plan.fills.length) {
    console.log(
      `Applied (${appliedFills.length}) does not equal planned (${plan.fills.length}) — ` +
        `fully explained by the ${skippedRacePersonIds.length} skipped above.`,
    );
  }
}

function formatAuditCandidate(c: { id: string; at: Date; actorBdId: string; fillCount: number }): string {
  return `  ${c.id} — at=${c.at.toISOString()} actor=${c.actorBdId} fills=${c.fillCount}`;
}

async function runRevert(args: Args) {
  const rows = await readAllFirstTokenSplitAuditRows();
  const selection = selectStuffedNameSplitAuditRow(rows, args.auditId);

  if (selection.kind === "none") {
    console.log("No non-empty person_first_token_split_backfill audit_log row found — nothing to revert.");
    return;
  }
  if (selection.kind === "not_found") {
    const lines = [
      `--audit-id=${selection.requestedAuditId} does not match any non-empty person_first_token_split_backfill audit_log row.`,
      selection.candidates.length
        ? `Available non-empty rows:\n${selection.candidates.map(formatAuditCandidate).join("\n")}`
        : "There are no non-empty rows to revert at all.",
    ];
    throw new Error(lines.join("\n"));
  }
  if (selection.kind === "ambiguous") {
    const lines = [
      "More than one non-empty person_first_token_split_backfill audit_log row exists — refusing to guess which one to revert.",
      "Re-run with --audit-id=<uuid> to choose one explicitly:",
      selection.candidates.map(formatAuditCandidate).join("\n"),
    ];
    throw new Error(lines.join("\n"));
  }

  const audit = selection.row;
  console.log(`Reverting audit_log row ${audit.id}: ${audit.fills.length} fill(s).`);

  const currentPersons = await readCurrentPersonsByIds(audit.fills.map((f) => f.personId));
  const plan = buildStuffedNameSplitRevertPlan({ auditedFills: audit.fills, currentPersons });

  console.log("");
  console.log(`Persons to revert to their original stuffed name (${plan.toRevert.length}):`);
  for (const item of plan.toRevert) {
    console.log(`  ${item.personId} -> "${item.originalFirstName}" / ${JSON.stringify(item.originalLastName)}`);
  }
  if (plan.skipped.length) {
    console.log(`Persons skipped (${plan.skipped.length}):`);
    for (const skip of plan.skipped) console.log(`  ${skip.personId}: ${skip.reason}`);
  }

  if (!args.execute) {
    console.log("");
    console.log("Revert dry run only — no writes performed. Re-run with --revert --execute --actor=<bd id> to apply.");
    return;
  }

  let revertedPersonIds: string[] = [];
  const companiesUnlinkedPersonIds: string[] = [];
  const companiesDeleted: string[] = [];

  await db.transaction(async (tx) => {
    const fillByPersonId = new Map(audit.fills.map((f) => [f.personId, f] as const));
    if (plan.toRevert.length > 0) {
      const values = plan.toRevert.map((item) => {
        const fill = fillByPersonId.get(item.personId)!;
        return sql`(${item.personId}::uuid, ${fill.firstName}::text, ${fill.lastName}::text, ${item.originalFirstName}::text, ${item.originalLastName}::text)`;
      });
      const revertedRows = (await tx.execute(sql`
        UPDATE person AS p
        SET first_name = v.original_first_name,
            last_name = v.original_last_name,
            updated_at = now()
        FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, first_name, last_name, original_first_name, original_last_name)
        WHERE p.id = v.id
          AND p.first_name = v.first_name
          AND p.last_name = v.last_name
        RETURNING p.id
      `)) as unknown as { id: string }[];
      revertedPersonIds = revertedRows.map((r) => r.id);
    }

    // Company un-link (+ conditional delete) — ONLY for the "Smart Gen"
    // manual override's fill (the only one with `linkedCompany` set), and
    // only when that person's NAME revert actually applied above.
    for (const personId of revertedPersonIds) {
      const linkedCompany = fillByPersonId.get(personId)?.linkedCompany;
      if (!linkedCompany) continue;

      const [unlinked] = await tx
        .update(person)
        .set({ company: null, companyKey: null, updatedAt: new Date(), updatedByBdId: args.actor })
        .where(and(eq(person.id, personId), eq(person.companyKey, linkedCompany.companyKey)))
        .returning({ id: person.id });
      if (!unlinked) continue;

      companiesUnlinkedPersonIds.push(personId);
      await tx.insert(personPropertyHistory).values([
        { personId, property: "company", oldValue: linkedCompany.displayName, newValue: null, changedByBdId: null, source: "migration" },
        { personId, property: "companyKey", oldValue: linkedCompany.companyKey, newValue: null, changedByBdId: null, source: "migration" },
      ]);

      if (linkedCompany.createdNewCompany) {
        const [stillReferenced] = await tx
          .select({ id: person.id })
          .from(person)
          .where(and(eq(person.companyKey, linkedCompany.companyKey), isNull(person.mergedIntoId)))
          .limit(1);
        if (!stillReferenced) {
          await tx.delete(company).where(eq(company.companyKey, linkedCompany.companyKey));
          companiesDeleted.push(linkedCompany.companyKey);
        }
      }
    }

    await tx.insert(auditLog).values({
      actorBdId: args.actor!,
      action: FIRST_TOKEN_SPLIT_REVERT_ACTION,
      metadata: {
        revertedAuditLogId: audit.id,
        personIdsReverted: revertedPersonIds,
        personsSkipped: plan.skipped,
        companiesUnlinkedPersonIds,
        companiesDeleted,
      },
    });
  });

  console.log("");
  console.log(`Reverted ${revertedPersonIds.length} person name(s).`);
  if (companiesUnlinkedPersonIds.length) {
    console.log(`Unlinked company for ${companiesUnlinkedPersonIds.length} person(s): ${companiesUnlinkedPersonIds.join(", ")}`);
  }
  if (companiesDeleted.length) {
    console.log(`Deleted ${companiesDeleted.length} company row(s) this run created and that nothing else references: ${companiesDeleted.join(", ")}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.execute && !args.actor) {
    throw new Error("--execute requires --actor=<bd id> for the audit log");
  }

  if (args.revert) {
    await runRevert(args);
  } else {
    await runForwardBackfill(args);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

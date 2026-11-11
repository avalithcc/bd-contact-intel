/**
 * Owner-operated OWNERSHIP RELEASE for a BD who left the company: their book
 * of business ends up with NO owner, instead of an owner who can no longer
 * sign in. Nothing is deleted and nothing is handed to another BD.
 *
 * It is the third step of offboarding, after scripts/revoke-bd-access.ts
 * (blocks the login) and scripts/disconnect-bd-mailbox.ts (stops the Gmail
 * sync). Those two stop the person. This one frees the records.
 *
 * WHAT "NO OWNER" MEANS HERE — the schema already answers it, per column:
 *
 *   person.owner_bd_id   (on delete SET NULL)  -> released. This is the live
 *     ownership surface, and /contacts has a first-class "Sin responsable"
 *     filter, so a released person is immediately findable and claimable by
 *     anyone (src/app/(app)/contacts/page.tsx, ownerSelectOptions).
 *   company.owner_bd_id  (on delete SET NULL)  -> released. /companies has no
 *     "unassigned" filter, so these show with an empty owner cell under
 *     "cualquiera" rather than as their own group. Still visible, still
 *     claimable.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH, and why — each of these looks like
 * ownership and is not:
 *
 *   task.assigned_to_bd_id — nullable in the schema, but the product never
 *     produces NULL: a blank assignee means "assign to me"
 *     (src/lib/tasks/assignee.ts#resolveTaskAssignee). Nulling them is
 *     strictly worse than leaving them: /tasks offers no "unassigned" filter,
 *     so they become unfindable, AND the list renders a null assignee as the
 *     VIEWER'S OWN NAME (`task.assignedToName ?? me.name`,
 *     src/app/(app)/tasks/page.tsx) — every viewer would see them as their
 *     own. Left pointing at the departing BD, where they are at least
 *     filterable by her name.
 *   contact.bd_id, lead.owner_bd_id — NOT NULL / legacy. `contact` and `lead`
 *     are the frozen pre-unification tables: "`contact`/`lead` stay read-only
 *     once this ships" (src/db/schema.ts, the unified Contact model block).
 *     They are the historical import record, not a live ownership surface.
 *   follow_up_queue_item.bd_id — NOT NULL, on delete cascade. This is not
 *     ownership at all: it is one BD's dated daily queue. With the login
 *     blocked no new rows are generated and the old ones simply stop being
 *     worked.
 *   person_bd_connection, activity, email_message, meeting, audit_log — the
 *     departing BD's history. Repointing it would be falsifying who did the
 *     work.
 *
 * THE DETAIL THAT MAKES OR BREAKS THIS: `person.owner_bd_id` is recomputed
 * every night at 03:00 ART under the last-worked rule
 * (src/app/api/owners/recompute/route.ts). A departing BD is the BD who
 * worked most of these people LAST, so a plain `set owner_bd_id = null` is
 * handed straight back to her tonight — and, being thousands of changes,
 * blows the cron's 25-change cap and fails the whole nightly run with a 500
 * from then on. The only thing that rule will not touch is a MANUAL owner
 * marker: a `person_property_history` row, property 'ownerBdId', source
 * 'edit' (src/lib/identity/ownerRule.ts#hasManualOwner). So this writes the
 * marker in the SAME transaction as the release — exactly the write shape
 * the app's own "Asignar responsable > sin responsable" bulk action uses
 * (src/lib/contacts/bulkOwnerDb.ts#bulkAssignOwner).
 *
 * PROOF, NOT TRUST: after the transaction commits, the script reads back
 * from the database how many rows still point at the departing BD and how
 * many markers this run actually wrote, and refuses to claim success unless
 * both numbers are right (src/lib/auth/ownershipRelease.ts).
 *
 * REVERSIBLE: every released row's previous owner is recorded in
 * person_property_history / company_property_history (old_value), so the
 * release can be read back and undone per row.
 *
 * IDEMPOTENT: a second run finds nothing to release and exits 0.
 *
 * Exit codes:
 *   0 = released (or nothing to release) AND the audit_log row was written
 *   1 = nothing changed — bad arguments, unresolved target or actor, or the
 *       guard refused before writing
 *   2 = rows WERE released but the read-back or the audit insert failed
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/release-bd-ownership.ts --email=<bd email>
 *   npx tsx --env-file=.env scripts/release-bd-ownership.ts --email=<bd email> --execute --actor=<bd id>
 *
 * Needs only DATABASE_URL (.env). Never prints the connection string.
 */
import { and, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  auditLog,
  bd,
  company,
  companyPropertyHistory,
  person,
  personPropertyHistory,
} from "../src/db/schema";
import { planOwnerAssignment } from "../src/lib/contacts/bulkOwner";
import { AUDIT_LOG_ID_CAP } from "../src/lib/contacts/bulkOwnerAudit";
import { MANUAL_OWNER_SOURCE, OWNER_HISTORY_PROPERTY } from "../src/lib/identity/ownerRule";
import { unmarkedReleases, verifyPersonRelease } from "../src/lib/auth/ownershipRelease";

export const OWNERSHIP_RELEASE_AUDIT_ACTION = "bd_ownership_released";

/** Keeps one statement's bind parameters well under Postgres' 65535 limit. */
const CHUNK = 1000;

type Args = { email?: string; execute: boolean; actor?: string };

function parseArgs(argv: readonly string[]): Args {
  const out: Args = { execute: false };
  for (const arg of argv) {
    if (arg === "--execute") out.execute = true;
    else if (arg.startsWith("--email=")) out.email = arg.slice("--email=".length).trim();
    else if (arg.startsWith("--actor=")) out.actor = arg.slice("--actor=".length).trim();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The released population, used identically by the plan, the read-back and
 * the dry run so the three can never disagree. Merged-away persons are
 * excluded on purpose: they are hidden from every screen and the owner cron
 * skips them too (src/lib/identity/ownerBackfillRun.ts), so repointing them
 * would change a number nobody reads.
 */
function livePersonsOwnedBy(bdId: string) {
  return and(eq(person.ownerBdId, bdId), isNull(person.mergedIntoId));
}

async function countRows(table: "person" | "company", bdId: string) {
  const rows =
    table === "person"
      ? await db.select({ n: sql<number>`count(*)::int` }).from(person).where(livePersonsOwnedBy(bdId))
      : await db.select({ n: sql<number>`count(*)::int` }).from(company).where(eq(company.ownerBdId, bdId));
  return rows[0]?.n ?? 0;
}

async function readFootprint(bdId: string) {
  const [persons, companies] = await Promise.all([countRows("person", bdId), countRows("company", bdId)]);
  const merged = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(person)
    .where(and(eq(person.ownerBdId, bdId), isNotNull(person.mergedIntoId)));
  const untouched = await db.execute<{ tasks: number; contacts: number; leads: number; follow_ups: number }>(sql`
    select
      (select count(*)::int from task where assigned_to_bd_id = ${bdId}::uuid) as tasks,
      (select count(*)::int from contact where bd_id = ${bdId}::uuid) as contacts,
      (select count(*)::int from lead where owner_bd_id = ${bdId}::uuid) as leads,
      (select count(*)::int from follow_up_queue_item where bd_id = ${bdId}::uuid) as follow_ups
  `);
  const u = [...untouched][0];
  return {
    persons,
    companies,
    mergedPersons: merged[0]?.n ?? 0,
    tasks: u?.tasks ?? 0,
    contacts: u?.contacts ?? 0,
    leads: u?.leads ?? 0,
    followUps: u?.follow_ups ?? 0,
  };
}

/** Markers this run wrote, counted by actor + time so it never credits an older edit. */
async function countMarkersWrittenSince(actorBdId: string, since: Date): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(distinct ${personPropertyHistory.personId})::int` })
    .from(personPropertyHistory)
    .where(
      and(
        eq(personPropertyHistory.property, OWNER_HISTORY_PROPERTY),
        eq(personPropertyHistory.source, MANUAL_OWNER_SOURCE),
        eq(personPropertyHistory.changedByBdId, actorBdId),
        sql`${personPropertyHistory.at} >= ${since.toISOString()}::timestamptz`,
      ),
    );
  return rows[0]?.n ?? 0;
}

async function executeRelease(params: { actorBdId: string; targetBdId: string; targetEmail: string; targetName: string }) {
  const { actorBdId, targetBdId, targetEmail, targetName } = params;

  const [actor] = await db.select({ id: bd.id }).from(bd).where(eq(bd.id, actorBdId)).limit(1);
  if (!actor) throw new Error(`--actor=${actorBdId} does not match any bd row.`);

  const startedAt = new Date();

  const result = await db.transaction(async (tx) => {
    const personRows = await tx
      .select({ id: person.id, ownerBdId: person.ownerBdId })
      .from(person)
      .where(livePersonsOwnedBy(targetBdId));

    // The manual-owner set is intentionally empty: every row here is owned by
    // the departing BD, so its owner differs from the target (null), which
    // puts it in BOTH `toUpdate` and `history` regardless of any existing
    // marker (src/lib/contacts/bulkOwner.ts#planOwnerAssignment). The guard
    // below is what proves that reasoning instead of assuming it.
    const plan = planOwnerAssignment(personRows, null, new Set<string>());
    const missing = unmarkedReleases(plan.toUpdate, plan.history);
    if (missing.length) {
      throw new Error(
        `REFUSING: ${missing.length} of ${plan.toUpdate.length} person row(s) would be released with no ` +
          "manual-owner marker. The 03:00 owner recompute would hand them straight back to the departing BD. " +
          "Nothing was changed.",
      );
    }

    for (const ids of chunked(plan.toUpdate, CHUNK)) {
      await tx
        .update(person)
        .set({ ownerBdId: null, updatedByBdId: actorBdId, updatedAt: new Date() })
        .where(inArray(person.id, ids));
    }
    for (const batch of chunked(plan.history, CHUNK)) {
      await tx.insert(personPropertyHistory).values(
        batch.map((h) => ({
          personId: h.personId,
          property: OWNER_HISTORY_PROPERTY,
          oldValue: h.oldValue,
          newValue: null,
          changedByBdId: actorBdId,
          source: MANUAL_OWNER_SOURCE,
        })),
      );
    }

    const companyRows = await tx
      .select({ companyKey: company.companyKey })
      .from(company)
      .where(eq(company.ownerBdId, targetBdId));
    const companyKeys = companyRows.map((c) => c.companyKey);
    for (const keys of chunked(companyKeys, CHUNK)) {
      await tx
        .update(company)
        .set({ ownerBdId: null, updatedByBdId: actorBdId, updatedAt: new Date() })
        .where(inArray(company.companyKey, keys));
      await tx.insert(companyPropertyHistory).values(
        keys.map((companyKey) => ({
          companyKey,
          property: "ownerBdId",
          oldValue: targetBdId,
          newValue: null,
          changedByBdId: actorBdId,
          source: MANUAL_OWNER_SOURCE,
        })),
      );
    }

    await tx.insert(auditLog).values({
      actorBdId,
      action: OWNERSHIP_RELEASE_AUDIT_ACTION,
      targetBdId,
      metadata: {
        targetEmail,
        targetName,
        personsReleased: plan.toUpdate.length,
        companiesReleased: companyKeys.length,
        personIds: plan.toUpdate.slice(0, AUDIT_LOG_ID_CAP),
        companyKeys: companyKeys.slice(0, AUDIT_LOG_ID_CAP),
        truncated: plan.toUpdate.length > AUDIT_LOG_ID_CAP || companyKeys.length > AUDIT_LOG_ID_CAP,
        note:
          "person.owner_bd_id and company.owner_bd_id released to NULL for a BD who left the company. Each released " +
          "person also got a person_property_history row (property 'ownerBdId', source 'edit') so the 03:00 owner " +
          "recompute cannot hand them back. Tasks, the legacy contact/lead tables, the follow-up queue and all " +
          "history were deliberately left pointing at this BD — see the script header for the reason per column. " +
          "Reversible: old_value in the history rows holds each previous owner.",
      },
    });

    return { personsReleased: plan.toUpdate.length, companiesReleased: companyKeys.length };
  });

  const [remainingPersons, remainingCompanies, markersWritten] = await Promise.all([
    countRows("person", targetBdId),
    countRows("company", targetBdId),
    countMarkersWrittenSince(actorBdId, startedAt),
  ]);

  return { ...result, remainingPersons, remainingCompanies, markersWritten };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.email) {
    throw new Error(
      "Usage: npx tsx --env-file=.env scripts/release-bd-ownership.ts --email=<bd email> [--execute --actor=<bd id>]",
    );
  }
  if (args.execute && !args.actor) throw new Error("--execute requires --actor=<bd id> for the audit log");

  const [target] = await db
    .select({ id: bd.id, name: bd.name, email: bd.email })
    .from(bd)
    .where(sql`lower(${bd.email}) = lower(${args.email})`)
    .limit(1);
  if (!target) {
    console.error(`No bd row with email ${args.email}.`);
    process.exitCode = 1;
    return;
  }

  const before = await readFootprint(target.id);
  console.log(`Target BD:   ${target.name} <${target.email}> (bd id ${target.id})\n`);
  console.log("Would be released to NO owner:");
  console.log(`  person.owner_bd_id        ${before.persons}   -> findable under /contacts "Sin responsable"`);
  console.log(`  company.owner_bd_id       ${before.companies}   -> empty owner cell in /companies`);
  console.log("\nDeliberately left pointing at this BD (see the script header for why):");
  console.log(`  task.assigned_to_bd_id    ${before.tasks}   (no unassigned filter; a null assignee renders as the viewer's own name)`);
  console.log(`  contact.bd_id             ${before.contacts}   (legacy table, read-only since the unified Contact model)`);
  console.log(`  lead.owner_bd_id          ${before.leads}   (legacy table, read-only)`);
  console.log(`  follow_up_queue_item      ${before.followUps}   (her dated daily queue, not ownership)`);
  if (before.mergedPersons) {
    console.log(`  person (merged away)      ${before.mergedPersons}   (hidden on every screen; the owner cron skips them too)`);
  }

  if (!args.execute) {
    console.log("\nDry run only. Nothing was changed.");
    console.log("Re-run with --execute --actor=<bd id> to release ownership.");
    return;
  }

  if (!before.persons && !before.companies) {
    console.log("\nNothing to release. Exiting without writing.");
    return;
  }

  console.log(`\nReleasing ownership for ${target.email} (actor bd id ${args.actor})...`);
  const result = await executeRelease({
    actorBdId: args.actor!,
    targetBdId: target.id,
    targetEmail: target.email,
    targetName: target.name,
  });

  const verdict = verifyPersonRelease({
    releasedCount: result.personsReleased,
    remainingOwned: result.remainingPersons,
    markersWritten: result.markersWritten,
  });
  console.log(`\nReleased ${result.personsReleased} person row(s) and ${result.companiesReleased} company row(s).`);
  console.log(
    `Read-back: ${result.remainingPersons} person and ${result.remainingCompanies} company row(s) still owned; ` +
      `${result.markersWritten} manual-owner marker(s) written by this run.`,
  );
  if (!verdict.ok || result.remainingCompanies !== 0) {
    console.error(`\nRELEASE NOT PROVEN: ${verdict.problem ?? `${result.remainingCompanies} company row(s) still owned.`}`);
    process.exitCode = 2;
    return;
  }
  console.log(`Verified. One audit_log row written (action: ${OWNERSHIP_RELEASE_AUDIT_ACTION}).`);
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

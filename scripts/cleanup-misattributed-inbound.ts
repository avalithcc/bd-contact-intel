/**
 * Cleanup for the misattributed-inbound-sender bug (fixed in
 * src/lib/gmail/classify.ts, 2026-09-30 — see that file's doc comment,
 * "Direction-scoped matching"): before the fix, an INBOUND Gmail message
 * matched every CRM person appearing anywhere in From/To/Cc, not just the
 * sender. A person who only appeared in To/Cc of an automated inbound email
 * (e.g. an accounting system CC'ing them on "Transferencia exitosa") got a
 * spurious `reply_received` activity and could be flipped to `replied` even
 * though they never sent anything. Observed in prod on
 * rcrescentini@decreditos.com (person 9d22b1f8-90d9-45eb-bb8c-d254017b75c4).
 *
 * NEVER touches a row whose `match_confidence = 'thread'` (src/lib/gmail/threadAttribution.ts):
 * a reply attributed through its thread has a `from_address` that differs from the person's
 * address BY DEFINITION, so the comparison below would classify every one of them as
 * misattributed and delete the feature's output. The query and its exclusion live in
 * src/lib/gmail/misattributedInbound.ts, where tests/db/threadAttribution.test.ts exercises them.
 *
 * Finds every `email_message_person` row for an INBOUND `email_message`
 * whose matched person's `email_normalized` does not equal that message's
 * `from_address` (both lowercased/trimmed) — i.e. a match that could only
 * have come from a To/Cc address, never the sender — plus the
 * `reply_received` activity that match produced, found the same way the
 * write path links them: `activity.person_id` + `activity.actor_bd_id` (the
 * syncing BD) + `activity.metadata->>'gmailMessageId'`
 * (src/lib/gmail/syncQueries.ts). One query, no per-row loop
 * (PERFORMANCE.md).
 *
 * `--execute` deletes, in ONE transaction:
 *   1. the wrong `activity` rows
 *   2. the wrong `email_message_person` rows
 *   3. any `email_message` row left with ZERO `email_message_person` rows
 *      after step 2 — an inbound message whose only match was the wrong one
 *      never had the sender as a CRM match either, so per the corrected
 *      rule it should never have been stored at all
 * ...then recomputes `person.status` for every affected person with the
 * app's existing `recomputePersonStatuses` (src/lib/status/recompute.ts) in
 * the SAME transaction, and writes one `audit_log` row recording every
 * deleted id (for revert) plus the affected person ids.
 *
 * Does NOT touch: the manual `discarded` activity the owner logged by
 * mistake on person 9d22b1f8-90d9-45eb-bb8c-d254017b75c4 (2026-09-30 13:08,
 * `wrong_profile`) — that is a separate, owner-only cleanup, out of scope
 * here on purpose.
 *
 * Defaults to a DRY RUN (read-only): prints, per affected person, their
 * name/email, the number of wrong activities, and current -> recomputed
 * status (recomputed via the same pure `buildPersonStatusUpdates`
 * src/lib/status/recompute.ts uses, over the remaining activity rows with
 * the wrong ones excluded — no write happens to compute this). Nothing is
 * written until `--execute --actor=<bd id>`.
 *
 * Idempotent: after `--execute`, the deleted rows no longer satisfy the
 * candidate query (the `email_message_person`/`activity` rows are gone), so
 * re-running the dry run reports zero rows.
 *
 * Revert path: the `audit_log` row (action
 * `migration_cleanup_misattributed_inbound`) records every deleted
 * `activity.id`, `email_message_person.id`, and `email_message.id`, plus
 * the affected `person.id`s. To revert: restore those exact rows from a
 * pre-execute `pg_dump`/backup (see src/lib/migration/backup.ts for the
 * repo's snapshot convention), then re-run
 * `recomputePersonStatuses(tx, affectedPersonIds)` for the same person ids.
 *
 * Usage (dry run is the default — reads only):
 *   npx tsx --env-file=.env.local scripts/cleanup-misattributed-inbound.ts
 *   npx tsx --env-file=.env.local scripts/cleanup-misattributed-inbound.ts --execute --actor=<bd id>
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog } from "../src/db/schema";
import { buildPersonStatusUpdates } from "../src/lib/status/deriveStatus";
import { mapRawActivityRow, mapRawConnectionRow } from "../src/lib/status/rawStatusRows";
import { recomputePersonStatuses } from "../src/lib/status/recompute";
import { readWrongMatches, type WrongMatchRow } from "../src/lib/gmail/misattributedInbound";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

interface PersonInfo {
  id: string;
  name: string;
  email: string | null;
  status: string;
}

function idList(ids: readonly string[]) {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
}

async function readPersonsInfo(executor: DbOrTx, personIds: readonly string[]): Promise<Map<string, PersonInfo>> {
  if (personIds.length === 0) return new Map();
  const rows = await executor.execute<{
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    status: string;
  }>(sql`
    select id::text as id, first_name, last_name, email, status
    from person
    where id in (${idList(personIds)})
  `);

  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        name: [r.first_name, r.last_name].filter(Boolean).join(" ") || "(sin nombre)",
        email: r.email,
        status: r.status,
      },
    ]),
  );
}

/**
 * Recomputed status for each affected person AS IF the wrong activities were
 * already deleted — read-only, reuses the same pure `buildPersonStatusUpdates`
 * (src/lib/status/deriveStatus.ts) the real write path calls, over the
 * person's remaining `activity`/`person_bd_connection` rows with the
 * about-to-be-deleted activity ids excluded. No write happens here; this is
 * purely for the dry-run report.
 */
async function computeRecomputedStatuses(
  executor: DbOrTx,
  personIds: readonly string[],
  excludedActivityIds: readonly string[],
): Promise<Map<string, string>> {
  if (personIds.length === 0) return new Map();

  const excludeClause =
    excludedActivityIds.length > 0 ? sql`and id not in (${idList(excludedActivityIds)})` : sql``;

  const activityRows = await executor.execute<{
    id: string;
    type: string;
    created_at: string | Date;
    metadata: unknown;
    person_id: string;
  }>(sql`
    select id::text as id, type, created_at, metadata, person_id::text as person_id
    from activity
    where person_id in (${idList(personIds)})
    ${excludeClause}
  `);

  const connectionRows = await executor.execute<{
    bd_id: string;
    sent_count: number;
    received_count: number;
    last_message_at: string | Date | null;
    person_id: string;
  }>(sql`
    select bd_id::text as bd_id, sent_count, received_count, last_message_at, person_id::text as person_id
    from person_bd_connection
    where person_id in (${idList(personIds)})
  `);

  const normalizedActivityRows = activityRows.map(mapRawActivityRow);
  const normalizedConnectionRows = connectionRows.map(mapRawConnectionRow);

  const updates = buildPersonStatusUpdates(personIds, normalizedActivityRows, normalizedConnectionRows);
  return new Map(updates.map((u) => [u.personId, u.status]));
}

function parseArgs(argv: string[]): { execute: boolean; actor: string | null } {
  const known = new Set(["--execute"]);
  let actor: string | null = null;
  let execute = false;
  for (const arg of argv) {
    if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else if (known.has(arg)) execute = true;
    else throw new Error(`Unknown argument: ${arg}. Valid: --execute, --actor=<bd id>`);
  }
  if (execute && !actor) throw new Error("--execute requires --actor=<bd id> for the audit log");
  return { execute, actor };
}

async function printReport(wrongMatches: WrongMatchRow[], executor: DbOrTx) {
  if (wrongMatches.length === 0) {
    console.log("No misattributed inbound matches found. Nothing to do.");
    return;
  }

  const personIds = [...new Set(wrongMatches.map((m) => m.personId))];
  const activityIdsToDelete = wrongMatches.map((m) => m.activityId).filter((id): id is string => id !== null);

  // Sequential, not Promise.all: the connection pool is small (PERFORMANCE.md)
  // — these two reads do not parallelize meaningfully and this script runs
  // once, outside any request path, so there is no reason to hold two
  // connections at once.
  const personInfoById = await readPersonsInfo(executor, personIds);
  const recomputedStatusById = await computeRecomputedStatuses(executor, personIds, activityIdsToDelete);

  const wrongCountByPerson = new Map<string, number>();
  for (const m of wrongMatches) {
    wrongCountByPerson.set(m.personId, (wrongCountByPerson.get(m.personId) ?? 0) + (m.activityId ? 1 : 0));
  }

  console.log(`Misattributed inbound matches found: ${wrongMatches.length} (persons affected: ${personIds.length})`);
  console.log("");
  for (const personId of personIds) {
    const info = personInfoById.get(personId);
    const wrongActivityCount = wrongCountByPerson.get(personId) ?? 0;
    const currentStatus = info?.status ?? "?";
    const recomputedStatus = recomputedStatusById.get(personId) ?? "?";
    console.log(
      `${info?.name ?? "(unknown)"} <${info?.email ?? "no-email"}> (${personId}): ${wrongActivityCount} wrong activity(ies), status ${currentStatus} -> ${recomputedStatus}`,
    );
  }
}

async function main() {
  const { execute, actor } = parseArgs(process.argv.slice(2));

  if (!execute) {
    const wrongMatches = await readWrongMatches(db);
    await printReport(wrongMatches, db);
    console.log("");
    console.log("Dry run only — nothing written. Re-run with --execute --actor=<bd id>.");
    return;
  }

  await db.transaction(async (tx) => {
    const wrongMatches = await readWrongMatches(tx);
    if (wrongMatches.length === 0) {
      console.log("No misattributed inbound matches found. Nothing to do.");
      return;
    }

    const personIds = [...new Set(wrongMatches.map((m) => m.personId))];
    const activityIds = wrongMatches.map((m) => m.activityId).filter((id): id is string => id !== null);
    const empIds = wrongMatches.map((m) => m.empId);
    const emailMessageIds = [...new Set(wrongMatches.map((m) => m.emailMessageId))];

    await printReport(wrongMatches, tx);

    if (activityIds.length > 0) {
      await tx.execute(sql`delete from activity where id in (${idList(activityIds)})`);
    }
    await tx.execute(sql`delete from email_message_person where id in (${idList(empIds)})`);

    // Step 3 cannot reach a thread-attributed message: it keeps its thread link row, so the
    // not-exists guard below holds for it even if it somehow shared an id with a wrong match.
    const deletedMessages = await tx.execute<{ id: string }>(sql`
      delete from email_message
      where id in (${idList(emailMessageIds)})
        and not exists (select 1 from email_message_person emp where emp.email_message_id = email_message.id)
      returning id::text as id
    `);

    await recomputePersonStatuses(tx, personIds);

    await tx.insert(auditLog).values({
      actorBdId: actor!,
      action: "migration_cleanup_misattributed_inbound",
      metadata: {
        deletedActivityIds: activityIds,
        deletedEmailMessagePersonIds: empIds,
        deletedEmailMessageIds: deletedMessages.map((m) => m.id),
        affectedPersonIds: personIds,
      },
    });

    console.log("");
    console.log(
      `Executed. Deleted ${activityIds.length} activities, ${empIds.length} email_message_person rows, ${deletedMessages.length} email_message rows. Recomputed status for ${personIds.length} persons.`,
    );
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });

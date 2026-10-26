/**
 * Thin DB layer for scripts/suppress-calendar-notification.ts; the decisions
 * live in plan.ts. Dry run is a READ ONLY transaction. Execute re-reads and
 * re-plans inside one transaction under the identity lock, adds the never-log
 * rules (addNeverLogEntry, the one existing writer, run on the transaction),
 * deletes the person and writes ONE audit_log row, so it is all or nothing.
 */
import { eq, inArray, and, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, emailNeverLog, person } from "@/db/schema";
import { getSyncableAccounts } from "@/lib/gmail/syncQueries";
import { addNeverLogEntry } from "@/lib/gmail/neverLog";
import { withIdentityLock } from "@/lib/identity/resolveDb";
import { isUuid } from "@/lib/uuid";
import {
  CALENDAR_AUDIT_ACTION,
  CALENDAR_SENDER_ADDRESS,
  planCalendarSuppression,
  type CalendarBlastRadius,
  type CalendarPlan,
} from "./plan";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface BlastRow extends Record<string, unknown> {
  activities: number | string;
  emp: number | string;
  tasks: number | string;
  meetings: number | string;
  scheduled: number | string;
  signals: number | string;
  scrape: number | string;
  queue: number | string;
  conn: number | string;
  idmap: number | string;
  history: number | string;
  lusha: number | string;
  dups: number | string;
  merges: number | string;
  seq: number | string;
  msgs: number | string;
}

/** One statement: every table that references person, counted by that person id. */
async function measureBlast(tx: DbTransaction, personId: string): Promise<CalendarBlastRadius> {
  const rows = (await tx.execute(sql`
    select
      (select count(*) from activity where person_id = ${personId}::uuid) as activities,
      (select count(*) from email_message_person where person_id = ${personId}::uuid) as emp,
      (select count(*) from task where person_id = ${personId}::uuid) as tasks,
      (select count(*) from meeting where person_id = ${personId}::uuid) as meetings,
      (select count(*) from scheduled_email where person_id = ${personId}::uuid) as scheduled,
      (select count(*) from signal where person_id = ${personId}::uuid) as signals,
      (select count(*) from linkedin_scrape_job where person_id = ${personId}::uuid) as scrape,
      (select count(*) from follow_up_queue_item where person_id = ${personId}::uuid) as queue,
      (select count(*) from person_bd_connection where person_id = ${personId}::uuid) as conn,
      (select count(*) from person_id_map where person_id = ${personId}::uuid) as idmap,
      (select count(*) from person_property_history where person_id = ${personId}::uuid) as history,
      (select count(*) from lusha_reveal where person_id = ${personId}::uuid) as lusha,
      (select count(*) from duplicate_candidate where person_a_id = ${personId}::uuid or person_b_id = ${personId}::uuid) as dups,
      (select count(*) from merge_event where merged_id = ${personId}::uuid or survivor_id = ${personId}::uuid) as merges,
      (select count(*) from sequence_member where person_id = ${personId}::uuid) as seq,
      (select count(distinct m.id) from email_message m
        where m.person_id = ${personId}::uuid
           or exists (select 1 from email_message_person j where j.email_message_id = m.id and j.person_id = ${personId}::uuid)) as msgs
  `)) as unknown as BlastRow[];
  const r = rows[0]!;
  const types = (await tx.execute(sql`
    select type, count(*) as n from activity where person_id = ${personId}::uuid group by type order by type
  `)) as unknown as { type: string; n: number | string }[];
  const n = (v: number | string) => Number(v);
  return {
    activities: n(r.activities),
    emailMessagePersonRows: n(r.emp),
    tasks: n(r.tasks),
    meetings: n(r.meetings),
    scheduledEmails: n(r.scheduled),
    signals: n(r.signals),
    linkedinScrapeJobs: n(r.scrape),
    followUpQueueItems: n(r.queue),
    personBdConnections: n(r.conn),
    personIdMaps: n(r.idmap),
    propertyHistoryRows: n(r.history),
    lushaReveals: n(r.lusha),
    duplicateCandidates: n(r.dups),
    mergeEvents: n(r.merges),
    sequenceMembers: n(r.seq),
    survivingEmailMessages: n(r.msgs),
    activityTypes: Object.fromEntries(types.map((t) => [t.type, n(t.n)])),
  };
}

async function load(tx: DbTransaction): Promise<{ plan: CalendarPlan; person: typeof person.$inferSelect | null }> {
  // Case-insensitive, by email only: nothing here knows an id.
  const found = await tx.select().from(person).where(sql`${person.emailNormalized} = ${CALENDAR_SENDER_ADDRESS} or lower(${person.email}) = ${CALENDAR_SENDER_ADDRESS}`).limit(2);
  const syncableBdIds = (await getSyncableAccounts()).map((a) => a.bdId);
  const ruled = await tx
    .select({ bdId: emailNeverLog.bdId })
    .from(emailNeverLog)
    .where(and(eq(emailNeverLog.kind, "address"), eq(emailNeverLog.value, CALENDAR_SENDER_ADDRESS)));
  const blast = found.length === 1 ? await measureBlast(tx, found[0]!.id) : null;
  const plan = planCalendarSuppression({ personIds: found.map((p) => p.id), syncableBdIds, alreadyRuledBdIds: ruled.map((r) => r.bdId), blast });
  return { plan, person: found.length === 1 ? found[0]! : null };
}

export async function dryRunSuppress(): Promise<CalendarPlan> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    return (await load(tx)).plan;
  });
}

export async function executeSuppress(actorBdId: string): Promise<{ plan: CalendarPlan; auditLogId: string | null }> {
  if (!isUuid(actorBdId)) throw new Error("--actor must be a bd uuid.");
  return db.transaction(async (tx) =>
    withIdentityLock(tx, async () => {
      const { plan, person: row } = await load(tx);
      if (plan.kind === "refuse" || !row) return { plan, auditLogId: null };

      // Step 1: one rule per syncing BD, through the existing writer (on conflict do nothing).
      for (const bdId of plan.addRuleBdIds) await addNeverLogEntry(bdId, "address", CALENDAR_SENDER_ADDRESS, tx);

      // Step 2: delete by the id the email lookup resolved, re-checking the email in SQL.
      const gone = await tx
        .delete(person)
        .where(and(inArray(person.id, [plan.personId]), sql`(${person.emailNormalized} = ${CALENDAR_SENDER_ADDRESS} or lower(${person.email}) = ${CALENDAR_SENDER_ADDRESS})`))
        .returning({ id: person.id });
      if (gone.length !== 1) throw new Error(`Expected to delete 1 person, deleted ${gone.length}.`);

      const [audit] = await tx
        .insert(auditLog)
        .values({
          actorBdId,
          action: CALENDAR_AUDIT_ACTION,
          metadata: {
            address: CALENDAR_SENDER_ADDRESS,
            deletedPersonId: plan.personId,
            // Revert: (1) re-INSERT deletedPerson into person (same id); (2) delete from email_never_log where
            // kind = 'address' and value = address and bd_id in addedRuleBdIds (NOT alreadyRuledBdIds, they pre-existed).
            // The cascaded activities and email_message_person rows are not restorable; email_message rows were kept.
            deletedPerson: row,
            addedRuleBdIds: plan.addRuleBdIds,
            alreadyRuledBdIds: plan.alreadyRuledBdIds,
            cascaded: plan.blast,
          },
        })
        .returning({ id: auditLog.id });
      return { plan, auditLogId: audit!.id };
    }),
  );
}

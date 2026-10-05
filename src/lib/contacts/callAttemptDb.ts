/**
 * DB side of the call attempt (call-logging-one-tap). The rules live in
 * callAttempt.ts; this only reads and writes.
 *
 * Round trips: a dial is 2 (one read of the person plus the BD's attempts
 * inside the dedupe window, one insert); an answer without a conversation is
 * 2 (read the attempt, one update); "Hablé" adds one transaction. The attempt
 * is inserted directly and does NOT go through createActivityInTx: it can
 * never change status (deriveStatus.ts#STATUS_NEUTRAL_ACTIVITY_TYPES), so the
 * status recompute would be a wasted read.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { activity, person } from "@/db/schema";
import { createActivityInTx } from "@/lib/activity/queries";
import { assertContactEditable } from "@/lib/contacts/mergeGuard";
import { ContactNotFoundError } from "@/lib/contacts/errors";
import {
  CALL_ATTEMPT_TYPE,
  CallAttemptResolvedError,
  dedupeCutoff,
  findDuplicateAttempt,
  planAttemptMetadata,
  planAttemptResolution,
  resolveDialledField,
} from "@/lib/contacts/callAttempt";

export class CallAttemptNotFoundError extends Error {
  constructor() {
    super("Call attempt not found for this contact and BD");
    this.name = "CallAttemptNotFoundError";
  }
}

export class DialledNumberNotOnContactError extends Error {
  constructor() {
    super("The dialled number is not one of this contact's numbers");
    this.name = "DialledNumberNotOnContactError";
  }
}

export interface RecordedAttempt {
  attemptId: string;
  /** ISO instant of the dial: the row's `created_at`. */
  dialledAt: string;
  /** True when this click was folded into an attempt already recorded for the same dial. */
  duplicate: boolean;
}

export async function recordCallAttempt(
  personId: string,
  bdId: string,
  rawNumber: string,
  now: Date = new Date(),
): Promise<RecordedAttempt> {
  const rows = await db
    .select({
      mergedIntoId: person.mergedIntoId,
      phone: person.phone,
      mobilePhone: person.mobilePhone,
      attemptId: activity.id,
      attemptActor: activity.actorBdId,
      attemptAt: activity.createdAt,
      attemptNumber: sql<string | null>`${activity.metadata}->>'number'`,
    })
    .from(person)
    .leftJoin(
      activity,
      and(eq(activity.personId, person.id), eq(activity.type, CALL_ATTEMPT_TYPE), gte(activity.createdAt, dedupeCutoff(now)),
        // An answered attempt is a finished dial: dialling again is a new one.
        sql`(${activity.metadata}->>'outcome') is null`,
      ),
    )
    .where(eq(person.id, personId))
    .limit(20);
  const head = rows[0];
  if (!head) throw new ContactNotFoundError(personId);
  assertContactEditable(head);
  const field = resolveDialledField(rawNumber, head);
  if (!field) throw new DialledNumberNotOnContactError();

  const recent = rows
    .filter((r) => r.attemptId && r.attemptAt)
    .map((r) => ({ id: r.attemptId!, actorBdId: r.attemptActor, number: r.attemptNumber, createdAt: r.attemptAt! }));
  const duplicate = findDuplicateAttempt(recent, { bdId, number: rawNumber }, now);
  if (duplicate) return { attemptId: duplicate.id, dialledAt: duplicate.createdAt.toISOString(), duplicate: true };

  const [row] = await db
    .insert(activity)
    .values({ type: CALL_ATTEMPT_TYPE, personId, actorBdId: bdId, metadata: planAttemptMetadata(rawNumber, field) })
    .returning({ id: activity.id, createdAt: activity.createdAt });
  return { attemptId: row!.id, dialledAt: row!.createdAt.toISOString(), duplicate: false };
}

/** Answers the outcome bar. Returns the id of the `call` row when "Hablé" wrote one. */
export async function resolveCallAttempt(
  attemptId: string,
  personId: string,
  bdId: string,
  outcome: string,
  notes: string,
): Promise<{ callId: string | null }> {
  const [personRow] = await db.select({ mergedIntoId: person.mergedIntoId }).from(person).where(eq(person.id, personId));
  if (!personRow) throw new ContactNotFoundError(personId);
  assertContactEditable(personRow);

  const [attempt] = await db
    .select({ createdAt: activity.createdAt, metadata: activity.metadata })
    .from(activity)
    .where(
      and(
        eq(activity.id, attemptId),
        eq(activity.personId, personId),
        eq(activity.actorBdId, bdId),
        eq(activity.type, CALL_ATTEMPT_TYPE),
      ),
    );
  if (!attempt) throw new CallAttemptNotFoundError();
  const plan = planAttemptResolution(attempt, outcome, notes);

  // Never overwrites an outcome that landed in between (two tabs, double click).
  const closeAttempt = (executor: Pick<typeof db, "update">, patch: Record<string, unknown>) =>
    executor
      .update(activity)
      .set({ metadata: sql`${activity.metadata} || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() })
      .where(and(eq(activity.id, attemptId), sql`(${activity.metadata}->>'outcome') is null`))
      .returning({ id: activity.id });

  if (!plan.call) {
    const closed = await closeAttempt(db, plan.attemptPatch);
    if (closed.length === 0) throw new CallAttemptResolvedError();
    return { callId: null };
  }
  const call = plan.call;
  return db.transaction(async (tx) => {
    const created = await createActivityInTx(tx, { type: "call", personId, actorBdId: bdId, metadata: { ...call } });
    // Links the attempt to its call so the timeline shows the conversation once, not the dial twice.
    const closed = await closeAttempt(tx, { ...plan.attemptPatch, callActivityId: created.id });
    if (closed.length === 0) throw new CallAttemptResolvedError();
    return { callId: created.id };
  });
}

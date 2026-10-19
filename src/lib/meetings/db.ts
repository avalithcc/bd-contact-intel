/**
 * Writes of the meeting lifecycle (meeting-outcomes). Every function is ONE transaction: the meeting row, the activity that
 * records the change with its actor, the contact status recompute (createActivityInTx) and, for a no-show or a cancellation, the
 * follow-up task all commit together or not at all. What each write means is decided by the pure rules in outcome.ts; this file
 * only applies them. Imports `db`, so it is exercised by tests/db/meetings.test.ts against a scratch database.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { activity, meeting, task, type Meeting } from "@/db/schema";
import { createActivityInTx } from "@/lib/activity/queries";
import { recomputePersonStatus } from "@/lib/status/recompute";
import { createTask } from "@/lib/tasks/queries";
import { buildTaskActivityRow } from "@/lib/tasks/taskActivityBody";
import {
  MeetingOutcomeError,
  canRemoveFollowUpTask,
  planMeetingEntry,
  planOutcome,
  planUndo,
  type OutcomeInput,
} from "@/lib/meetings/outcome";
import type { MeetingStatus, OutcomeChoice } from "@/lib/meetings/status";

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const ACTIVITY_TYPE_BY_STATUS: Record<OutcomeChoice, string> = {
  held: "meeting_logged",
  no_show: "meeting_no_show",
  rescheduled: "meeting_rescheduled",
  cancelled: "meeting_cancelled",
};

/** `database` exists for tests/db (a rolled-back transaction); production passes nothing. */
export interface MeetingDbDeps {
  database?: Pick<typeof db, "transaction">;
}

export interface RegisterMeetingResult {
  kind: "scheduled" | "held";
  meetingId: string;
}

/**
 * "Registrar reunión": a date and time still ahead is saved as Agendada, one at or before now as Realizada, exactly the
 * behaviour logged meetings had before (a `meeting_logged` activity, so the contact moves to "Reunión").
 */
export async function registerContactMeeting(
  personId: string,
  bdId: string,
  rawDate: string,
  rawTime: string,
  rawNotes: string,
  now: Date = new Date(),
  { database = db }: MeetingDbDeps = {},
): Promise<RegisterMeetingResult> {
  const plan = planMeetingEntry(rawDate, rawTime, rawNotes, now);
  return database.transaction(async (tx) => {
    const [created] = await tx
      .insert(meeting)
      .values({
        personId,
        bdId,
        scheduledAt: plan.at,
        status: plan.kind,
        notes: plan.notes,
        ...(plan.kind === "held" ? { outcomeAt: now, outcomeByBdId: bdId } : {}),
      })
      .returning({ id: meeting.id });
    const meetingId = created!.id;
    const row = await createActivityInTx(tx, {
      type: plan.kind === "held" ? "meeting_logged" : "meeting_scheduled",
      personId,
      actorBdId: bdId,
      metadata: { at: plan.at.toISOString(), notes: plan.notes, meetingId },
    });
    if (plan.kind === "held") await tx.update(meeting).set({ heldActivityId: row.id }).where(eq(meeting.id, meetingId));
    return { kind: plan.kind, meetingId };
  });
}

export interface ApplyOutcomeResult {
  outcome: OutcomeChoice;
  personId: string;
  /** The meeting a reschedule opened. */
  nextMeetingId: string | null;
  followUpTaskId: string | null;
}

async function lockMeeting(tx: DbTx, meetingId: string): Promise<Meeting> {
  const [row] = await tx.select().from(meeting).where(eq(meeting.id, meetingId)).for("update");
  if (!row) throw new MeetingOutcomeError("meeting_not_found");
  return row;
}

/**
 * Confirms the outcome of one scheduled meeting. The row is locked first, so two clicks (or two tabs) cannot both close it:
 * the second finds it no longer open and is refused with `meeting_not_open`.
 */
export async function applyMeetingOutcome(
  meetingId: string,
  actorBdId: string,
  input: OutcomeInput,
  followUpTitles: { no_show: string; cancelled: string },
  now: Date = new Date(),
  { database = db }: MeetingDbDeps = {},
): Promise<ApplyOutcomeResult> {
  return database.transaction(async (tx) => {
    const current = await lockMeeting(tx, meetingId);
    const plan = planOutcome(
      { id: current.id, bdId: current.bdId, status: current.status as MeetingStatus, scheduledAt: current.scheduledAt, notes: current.notes },
      input,
      { actorId: actorBdId, now, followUpTitles },
    );

    let nextMeetingId: string | null = null;
    if (plan.nextMeeting) {
      const [next] = await tx
        .insert(meeting)
        .values({
          personId: current.personId,
          bdId: current.bdId,
          scheduledAt: plan.nextMeeting.scheduledAt,
          notes: plan.nextMeeting.notes,
          rescheduledFromId: current.id,
        })
        .returning({ id: meeting.id });
      nextMeetingId = next!.id;
    }

    const metadata = nextMeetingId ? { ...plan.activity.metadata, newMeetingId: nextMeetingId } : plan.activity.metadata;
    const row = await createActivityInTx(tx, { type: plan.activity.type, personId: current.personId, actorBdId, metadata });

    let followUpTaskId: string | null = null;
    if (plan.followUp) {
      const created = await createTask(
        { title: plan.followUp.title, personId: current.personId, dueAt: plan.followUp.dueAt, assignedToBdId: actorBdId, actorBdId },
        tx,
      );
      followUpTaskId = created.id;
      await tx
        .insert(activity)
        .values(buildTaskActivityRow("task_created", created, actorBdId, { taskId: created.id, taskTitle: created.title }));
    }

    await tx
      .update(meeting)
      .set({
        ...plan.update,
        rescheduledToId: nextMeetingId,
        heldActivityId: plan.outcome === "held" ? row.id : null,
        followUpTaskId,
        updatedAt: now,
      })
      .where(eq(meeting.id, current.id));

    return { outcome: plan.outcome, personId: current.personId, nextMeetingId, followUpTaskId };
  });
}

/** Takes back the outcome just confirmed; the rule (who, how long, what is removed) is documented in outcome.ts. */
export async function undoMeetingOutcome(
  meetingId: string,
  actorBdId: string,
  now: Date = new Date(),
  { database = db }: MeetingDbDeps = {},
): Promise<{ personId: string }> {
  return database.transaction(async (tx) => {
    const current = await lockMeeting(tx, meetingId);
    const status = current.status as MeetingStatus;
    let next: Meeting | undefined;
    if (current.rescheduledToId) {
      [next] = await tx.select().from(meeting).where(eq(meeting.id, current.rescheduledToId)).for("update");
    }
    planUndo({ status, outcomeByBdId: current.outcomeByBdId, outcomeAt: current.outcomeAt }, next ? { status: next.status as MeetingStatus } : null, {
      actorId: actorBdId,
      now,
    });

    // The activity that save wrote: the one linked as held, or the single one of that type naming this meeting.
    await tx
      .delete(activity)
      .where(
        and(
          eq(activity.personId, current.personId),
          eq(activity.type, ACTIVITY_TYPE_BY_STATUS[status as OutcomeChoice]),
          sql`${activity.metadata}->>'meetingId' = ${current.id}`,
        ),
      );
    if (next) await tx.delete(meeting).where(eq(meeting.id, next.id));

    if (current.followUpTaskId) {
      const [created] = await tx.select().from(task).where(eq(task.id, current.followUpTaskId)).for("update");
      if (created && canRemoveFollowUpTask(created)) {
        await tx.delete(activity).where(and(eq(activity.personId, current.personId), sql`${activity.metadata}->>'taskId' = ${created.id}`));
        await tx.delete(task).where(eq(task.id, created.id));
      }
    }

    await tx
      .update(meeting)
      .set({
        status: "scheduled",
        outcomeAt: null,
        outcomeByBdId: null,
        outcomeNotes: null,
        reason: null,
        rescheduledToId: null,
        heldActivityId: null,
        followUpTaskId: null,
        updatedAt: now,
      })
      .where(eq(meeting.id, current.id));
    // A "Se hizo" that no longer exists must stop counting toward the contact's stage.
    await recomputePersonStatus(tx, current.personId);
    return { personId: current.personId };
  });
}

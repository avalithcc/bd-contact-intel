/**
 * Pure rules of the meeting lifecycle (meeting-outcomes): what time makes a meeting scheduled or held, which outcomes are
 * available when, exactly what each outcome writes, who may touch a meeting and when an undo is still possible. No I/O: the
 * DB layer (db.ts) runs these plans inside one transaction.
 *
 * Contact status and reports (owner decision): ONLY "Se hizo" is a held meeting. It writes the same `meeting_logged`
 * activity every meeting logged before this feature wrote, and that activity is what moves the contact to "Reunión" and what
 * the reports count. Every other outcome writes a status-neutral activity of its own type.
 *
 * Undo rule: the BD who confirmed an outcome can take it back for UNDO_WINDOW_MS. The meeting returns to `scheduled`; the
 * activity that save wrote is deleted (so a "Se hizo" stops counting and the contact status is recomputed); a reschedule's new
 * meeting is deleted if it is still untouched; a follow-up task that save created is deleted only while it is still open and
 * unedited, otherwise it is left alone (it has become the BD's own work).
 */
import { MeetingDateRequiredError } from "@/lib/contacts/meeting";
import { addDaysToDateString, argentinaCalendarDate, argentinaWallClockToUtc } from "@/lib/tasks/argentinaDate";
import { isOutcomeChoice, type MeetingStatus, type OutcomeChoice } from "@/lib/meetings/status";

export type MeetingOutcomeErrorReason =
  | "meeting_not_found"
  | "meeting_forbidden"
  | "meeting_not_open"
  | "meeting_outcome_invalid"
  | "meeting_outcome_too_early"
  | "meeting_new_time_required"
  | "meeting_new_time_in_past"
  | "meeting_follow_up_date_invalid"
  | "meeting_undo_unavailable";

export class MeetingOutcomeError extends Error {
  constructor(readonly reason: MeetingOutcomeErrorReason) {
    super(`Meeting outcome refused: ${reason}`);
    this.name = "MeetingOutcomeError";
  }
}

/** Typed reason for the errors this module throws, or null for anything else. */
export function meetingOutcomeErrorReason(err: unknown): MeetingOutcomeErrorReason | null {
  return err instanceof MeetingOutcomeError ? err.reason : null;
}

export interface MeetingTimeState {
  status: MeetingStatus;
  scheduledAt: Date;
}

/** The compare is exact (owner decision): a meeting later today is scheduled, one at or before this instant is held. */
export function planMeetingEntry(
  rawDate: string,
  rawTime: string,
  rawNotes: string,
  now: Date,
): { kind: "scheduled" | "held"; at: Date; notes: string | null } {
  const date = rawDate.trim();
  if (!date) throw new MeetingDateRequiredError();
  const at = argentinaWallClockToUtc(date, rawTime.trim() || "00:00");
  return { kind: at.getTime() > now.getTime() ? "scheduled" : "held", at, notes: rawNotes.trim() || null };
}

/** "Por confirmar": scheduled, and its time has passed. */
export function isPendingConfirmation(m: MeetingTimeState, now: Date): boolean {
  return m.status === "scheduled" && m.scheduledAt.getTime() <= now.getTime();
}

/** Which outcomes the dialog enables. "Se hizo" and "No se presentó" wait for the meeting time; the rest are always possible while open. */
export function availableOutcomes(m: MeetingTimeState, now: Date): Record<OutcomeChoice, boolean> {
  const open = m.status === "scheduled";
  const started = m.scheduledAt.getTime() <= now.getTime();
  return { held: open && started, no_show: open && started, rescheduled: open, cancelled: open };
}

/** Admins read every meeting but change only their own: ownership is the only rule. */
export function canMutateMeeting(viewerBdId: string, m: { bdId: string }): boolean {
  return viewerBdId === m.bdId;
}

/** The follow-up due date the dialog starts with: two Argentina days from now. */
export function defaultFollowUpDueDate(now: Date): string {
  return addDaysToDateString(argentinaCalendarDate(now), 2);
}

export interface OutcomeInput {
  outcome: string;
  /** "¿Qué se habló?" for Se hizo. */
  notes?: string;
  /** "Motivo" for No se presentó and Cancelada. */
  reason?: string;
  newDate?: string;
  newTime?: string;
  followUp?: boolean;
  followUpDueDate?: string;
}

export interface OutcomePlanContext {
  actorId: string;
  now: Date;
  /** Ready-made task titles (the caller owns the copy); only the two outcomes that offer a follow-up need one. */
  followUpTitles: { no_show: string; cancelled: string };
}

export interface OutcomePlan {
  outcome: OutcomeChoice;
  update: { status: OutcomeChoice; outcomeAt: Date; outcomeByBdId: string; outcomeNotes: string | null; reason: string | null };
  activity: { type: string; metadata: Record<string, unknown> };
  nextMeeting: { scheduledAt: Date; notes: string | null } | null;
  followUp: { dueAt: Date; title: string } | null;
}

const ACTIVITY_TYPE: Record<OutcomeChoice, string> = {
  held: "meeting_logged",
  no_show: "meeting_no_show",
  rescheduled: "meeting_rescheduled",
  cancelled: "meeting_cancelled",
};

const clean = (value: string | undefined): string | null => value?.trim() || null;

function isRealCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

/**
 * Validates an outcome against the meeting's current state and returns everything the save must write. Throws a
 * MeetingOutcomeError; never mutates its inputs.
 */
export function planOutcome(
  meeting: { id: string; bdId: string; status: MeetingStatus; scheduledAt: Date; notes: string | null },
  input: OutcomeInput,
  ctx: OutcomePlanContext,
): OutcomePlan {
  if (!canMutateMeeting(ctx.actorId, meeting)) throw new MeetingOutcomeError("meeting_forbidden");
  if (meeting.status !== "scheduled") throw new MeetingOutcomeError("meeting_not_open");
  if (!isOutcomeChoice(input.outcome)) throw new MeetingOutcomeError("meeting_outcome_invalid");
  const outcome = input.outcome;
  if (!availableOutcomes(meeting, ctx.now)[outcome]) throw new MeetingOutcomeError("meeting_outcome_too_early");

  const at = meeting.scheduledAt.toISOString();
  let outcomeNotes: string | null = null;
  let reason: string | null = null;
  let metadata: Record<string, unknown>;
  let nextMeeting: OutcomePlan["nextMeeting"] = null;
  let followUp: OutcomePlan["followUp"] = null;

  if (outcome === "held") {
    outcomeNotes = clean(input.notes);
    metadata = { at, notes: outcomeNotes ?? meeting.notes, meetingId: meeting.id };
  } else if (outcome === "rescheduled") {
    if (!input.newDate?.trim() || !input.newTime?.trim()) throw new MeetingOutcomeError("meeting_new_time_required");
    const next = argentinaWallClockToUtc(input.newDate.trim(), input.newTime.trim());
    if (Number.isNaN(next.getTime())) throw new MeetingOutcomeError("meeting_new_time_required");
    if (next.getTime() <= ctx.now.getTime()) throw new MeetingOutcomeError("meeting_new_time_in_past");
    nextMeeting = { scheduledAt: next, notes: meeting.notes };
    metadata = { meetingId: meeting.id, at, toAt: next.toISOString() };
  } else {
    reason = clean(input.reason);
    metadata = { meetingId: meeting.id, at, reason };
    if (input.followUp) {
      const due = input.followUpDueDate?.trim() ?? "";
      if (!isRealCalendarDate(due) || due < argentinaCalendarDate(ctx.now)) throw new MeetingOutcomeError("meeting_follow_up_date_invalid");
      // `due_at` is a bare calendar date at 00:00 UTC (see taskDueDate), never an Argentina instant.
      followUp = { dueAt: new Date(`${due}T00:00:00.000Z`), title: ctx.followUpTitles[outcome] };
    }
  }

  return {
    outcome,
    update: { status: outcome, outcomeAt: ctx.now, outcomeByBdId: ctx.actorId, outcomeNotes, reason },
    activity: { type: ACTIVITY_TYPE[outcome], metadata },
    nextMeeting,
    followUp,
  };
}

/** Long enough for a slow click on the toast's "Deshacer" and a flaky connection; short enough that an old outcome is final. */
export const UNDO_WINDOW_MS = 5 * 60 * 1000;

/** Throws unless the actor may undo this closed meeting now. `next` is the meeting a reschedule opened, if any. */
export function planUndo(
  meeting: { status: MeetingStatus; outcomeByBdId: string | null; outcomeAt: Date | null },
  next: { status: MeetingStatus } | null,
  ctx: { actorId: string; now: Date },
): void {
  if (meeting.status === "scheduled" || !meeting.outcomeAt) throw new MeetingOutcomeError("meeting_undo_unavailable");
  if (meeting.outcomeByBdId !== ctx.actorId) throw new MeetingOutcomeError("meeting_forbidden");
  if (ctx.now.getTime() - meeting.outcomeAt.getTime() > UNDO_WINDOW_MS) throw new MeetingOutcomeError("meeting_undo_unavailable");
  if (meeting.status === "rescheduled" && next?.status !== "scheduled") throw new MeetingOutcomeError("meeting_undo_unavailable");
}

/**
 * A task the save created is taken back only while nobody has touched it: open, and never edited since it was created.
 * The 1s allowance covers the create write stamping updatedAt a few milliseconds after createdAt.
 *
 * ABSOLUTE distance, not `updatedAt - createdAt`: a plain subtraction is negative whenever updatedAt sits BEFORE
 * createdAt, and a negative number passes `<= 1000`, so a row whose updatedAt moved backwards (a clock skew, a restore,
 * a caller writing a logical timestamp against a database-clock createdAt) read as untouched and the BD's edit was
 * DELETED. Deleting someone's work is the expensive direction; keeping a task that was perhaps not edited costs them one
 * dismissal. So the check fails safe: anything that is not plainly "written once" is treated as touched.
 */
export function canRemoveFollowUpTask(t: { status: string; createdAt: Date; updatedAt: Date }): boolean {
  return t.status === "open" && Math.abs(t.updatedAt.getTime() - t.createdAt.getTime()) <= 1000;
}

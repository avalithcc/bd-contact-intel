/**
 * Pure rules of the meeting lifecycle (meeting-outcomes): which time makes a meeting scheduled or held, which outcomes are
 * allowed when, what each outcome writes, who may touch a meeting, and when an undo is still possible.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { MeetingDateRequiredError } from "@/lib/contacts/meeting";
import { TIMELINE_PILL_GROUPS } from "@/lib/activity/timelinePills";
import { activityStageCandidate } from "@/lib/status/deriveStatus";
import { NON_TOUCH_ACTIVITY_TYPES } from "@/lib/contacts/effectiveActivityTime";
import { argentinaWallClockToUtc } from "@/lib/tasks/argentinaDate";
import {
  MeetingOutcomeError,
  UNDO_WINDOW_MS,
  availableOutcomes,
  canMutateMeeting,
  canRemoveFollowUpTask,
  defaultFollowUpDueDate,
  isPendingConfirmation,
  planMeetingEntry,
  planOutcome,
  planUndo,
  type OutcomePlanContext,
} from "@/lib/meetings/outcome";

// 12:00 ART on Thu 2026-10-22 (UTC-3 fixed offset).
const NOW = new Date("2026-10-22T15:00:00.000Z");
const ME = "bd-me";
const OTHER = "bd-other";

const meeting = (over: Partial<Parameters<typeof planOutcome>[0]> = {}) => ({
  id: "m1",
  bdId: ME,
  status: "scheduled" as const,
  scheduledAt: argentinaWallClockToUtc("2026-10-22", "11:00"), // an hour ago
  notes: "Demo del módulo",
  ...over,
});
const ctx = (over: Partial<OutcomePlanContext> = {}): OutcomePlanContext => ({
  actorId: ME,
  now: NOW,
  followUpTitles: { no_show: "Seguimiento: no se presentó", cancelled: "Seguimiento: reunión cancelada" },
  ...over,
});
const reasonOf = (fn: () => unknown): string | null => {
  try {
    fn();
  } catch (e) {
    return e instanceof MeetingOutcomeError ? e.reason : `other:${String(e)}`;
  }
  return null;
};

test("a meeting later today is scheduled; exactly now or earlier is held", () => {
  assert.equal(planMeetingEntry("2026-10-22", "12:30", "", NOW).kind, "scheduled");
  assert.equal(planMeetingEntry("2026-10-22", "12:00", "", NOW).kind, "held");
  assert.equal(planMeetingEntry("2026-10-16", "11:00", "x", NOW).kind, "held");
});

test("planMeetingEntry reads the wall clock as Argentina time, trims notes and needs a date", () => {
  const plan = planMeetingEntry("2026-10-23", "15:00", "  demo  ", NOW);
  assert.equal(plan.at.toISOString(), "2026-10-23T18:00:00.000Z");
  assert.equal(plan.notes, "demo");
  assert.equal(planMeetingEntry("2026-10-23", "", "", NOW).at.toISOString(), "2026-10-23T03:00:00.000Z");
  assert.throws(() => planMeetingEntry("", "10:00", "", NOW), MeetingDateRequiredError);
});

test("pending confirmation is a scheduled meeting whose time has passed", () => {
  assert.equal(isPendingConfirmation(meeting(), NOW), true);
  assert.equal(isPendingConfirmation(meeting({ scheduledAt: new Date("2026-10-22T16:00:00.000Z") }), NOW), false);
  assert.equal(isPendingConfirmation(meeting({ status: "held" }), NOW), false);
});

test("Se hizo and No se presentó are disabled before the meeting time; Reprogramada and Cancelada never are", () => {
  const future = meeting({ scheduledAt: new Date("2026-10-23T18:00:00.000Z") });
  assert.deepEqual(availableOutcomes(future, NOW), { held: false, no_show: false, rescheduled: true, cancelled: true });
  assert.deepEqual(availableOutcomes(meeting(), NOW), { held: true, no_show: true, rescheduled: true, cancelled: true });
  assert.deepEqual(availableOutcomes(meeting({ status: "held" }), NOW), { held: false, no_show: false, rescheduled: false, cancelled: false });
});

test("only the owning BD may change a meeting, an admin included", () => {
  assert.equal(canMutateMeeting(ME, { bdId: ME }), true);
  assert.equal(canMutateMeeting(OTHER, { bdId: ME }), false);
});

test("an outcome on a meeting of another BD is refused", () => {
  assert.equal(reasonOf(() => planOutcome(meeting({ bdId: OTHER }), { outcome: "held" }, ctx())), "meeting_forbidden");
});

test("an outcome on a meeting that already has one is refused (no transition out of a closed state)", () => {
  for (const status of ["held", "no_show", "rescheduled", "cancelled"] as const) {
    assert.equal(reasonOf(() => planOutcome(meeting({ status }), { outcome: "cancelled" }, ctx())), "meeting_not_open");
  }
});

test("an unknown outcome is refused", () => {
  assert.equal(reasonOf(() => planOutcome(meeting(), { outcome: "maybe" }, ctx())), "meeting_outcome_invalid");
});

test("held and no-show are refused before the meeting time", () => {
  const future = meeting({ scheduledAt: new Date("2026-10-23T18:00:00.000Z") });
  assert.equal(reasonOf(() => planOutcome(future, { outcome: "held" }, ctx())), "meeting_outcome_too_early");
  assert.equal(reasonOf(() => planOutcome(future, { outcome: "no_show" }, ctx())), "meeting_outcome_too_early");
});

test("Se hizo writes a meeting_logged activity dated at the scheduled time and carries the discussion notes", () => {
  const plan = planOutcome(meeting(), { outcome: "held", notes: "  Quedaron en enviar la propuesta  " }, ctx());
  assert.equal(plan.update.status, "held");
  assert.equal(plan.update.outcomeByBdId, ME);
  assert.equal(plan.update.outcomeNotes, "Quedaron en enviar la propuesta");
  assert.equal(plan.activity.type, "meeting_logged");
  assert.deepEqual(plan.activity.metadata, {
    at: "2026-10-22T14:00:00.000Z",
    notes: "Quedaron en enviar la propuesta",
    meetingId: "m1",
  });
  assert.equal(plan.nextMeeting, null);
  assert.equal(plan.followUp, null);
});

test("Se hizo without discussion notes falls back to the scheduling notes", () => {
  assert.equal(planOutcome(meeting(), { outcome: "held" }, ctx()).activity.metadata.notes, "Demo del módulo");
});

test("Reprogramada needs a new date and time, in the future", () => {
  assert.equal(reasonOf(() => planOutcome(meeting(), { outcome: "rescheduled" }, ctx())), "meeting_new_time_required");
  assert.equal(reasonOf(() => planOutcome(meeting(), { outcome: "rescheduled", newDate: "2026-10-26" }, ctx())), "meeting_new_time_required");
  assert.equal(
    reasonOf(() => planOutcome(meeting(), { outcome: "rescheduled", newDate: "2026-10-22", newTime: "09:00" }, ctx())),
    "meeting_new_time_in_past",
  );
});

test("Reprogramada closes the meeting and opens a new scheduled one with the same notes", () => {
  const plan = planOutcome(meeting(), { outcome: "rescheduled", newDate: "2026-10-26", newTime: "15:00" }, ctx());
  assert.equal(plan.update.status, "rescheduled");
  assert.equal(plan.nextMeeting?.scheduledAt.toISOString(), "2026-10-26T18:00:00.000Z");
  assert.equal(plan.nextMeeting?.notes, "Demo del módulo");
  assert.equal(plan.activity.type, "meeting_rescheduled");
  assert.deepEqual(plan.activity.metadata, { meetingId: "m1", at: "2026-10-22T14:00:00.000Z", toAt: "2026-10-26T18:00:00.000Z" });
  assert.equal(plan.followUp, null);
});

test("a future meeting can be rescheduled or cancelled before its time", () => {
  const future = meeting({ scheduledAt: new Date("2026-10-23T18:00:00.000Z") });
  assert.equal(planOutcome(future, { outcome: "rescheduled", newDate: "2026-10-30", newTime: "10:00" }, ctx()).update.status, "rescheduled");
  assert.equal(planOutcome(future, { outcome: "cancelled" }, ctx()).update.status, "cancelled");
});

test("No se presentó and Cancelada keep an optional reason and an optional follow-up task due on the chosen day", () => {
  const plan = planOutcome(
    meeting(),
    { outcome: "no_show", reason: "  tuvo un imprevisto ", followUp: true, followUpDueDate: "2026-10-24" },
    ctx(),
  );
  assert.equal(plan.update.reason, "tuvo un imprevisto");
  assert.equal(plan.activity.type, "meeting_no_show");
  assert.deepEqual(plan.activity.metadata, { meetingId: "m1", at: "2026-10-22T14:00:00.000Z", reason: "tuvo un imprevisto" });
  assert.deepEqual(plan.followUp, { dueAt: new Date("2026-10-24T00:00:00.000Z"), title: "Seguimiento: no se presentó" });

  const cancelled = planOutcome(meeting(), { outcome: "cancelled", followUp: true, followUpDueDate: "2026-10-24" }, ctx());
  assert.equal(cancelled.activity.type, "meeting_cancelled");
  assert.equal(cancelled.update.reason, null);
  assert.equal(cancelled.followUp?.title, "Seguimiento: reunión cancelada");

  assert.equal(planOutcome(meeting(), { outcome: "no_show", followUp: false }, ctx()).followUp, null);
});

test("a follow-up task needs a valid due date that is not in the past", () => {
  assert.equal(reasonOf(() => planOutcome(meeting(), { outcome: "no_show", followUp: true }, ctx())), "meeting_follow_up_date_invalid");
  assert.equal(reasonOf(() => planOutcome(meeting(), { outcome: "no_show", followUp: true, followUpDueDate: "2026-02-31" }, ctx())), "meeting_follow_up_date_invalid");
  assert.equal(reasonOf(() => planOutcome(meeting(), { outcome: "no_show", followUp: true, followUpDueDate: "2026-10-21" }, ctx())), "meeting_follow_up_date_invalid");
  assert.equal(planOutcome(meeting(), { outcome: "no_show", followUp: true, followUpDueDate: "2026-10-22" }, ctx()).followUp?.dueAt.toISOString(), "2026-10-22T00:00:00.000Z");
});

test("the follow-up checkbox is ignored for outcomes that do not offer it", () => {
  assert.equal(planOutcome(meeting(), { outcome: "held", followUp: true, followUpDueDate: "2026-10-24" }, ctx()).followUp, null);
});

test("the default follow-up date is two Argentina days from now", () => {
  assert.equal(defaultFollowUpDueDate(NOW), "2026-10-24");
  // 23:30 ART on the 22nd is already the 23rd in UTC: the Argentina day still wins.
  assert.equal(defaultFollowUpDueDate(new Date("2026-10-23T02:30:00.000Z")), "2026-10-24");
});

test("planOutcome never mutates its inputs and is repeatable", () => {
  const m = meeting();
  const input = { outcome: "no_show", reason: " x ", followUp: true, followUpDueDate: "2026-10-24" };
  const snapshot = JSON.stringify({ m, input });
  const a = planOutcome(m, input, ctx());
  const b = planOutcome(m, input, ctx());
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify({ m, input }), snapshot);
});

test("undo: only the BD who confirmed it, inside the window, on a closed meeting", () => {
  const closed = { status: "held" as const, outcomeByBdId: ME, outcomeAt: new Date(NOW.getTime() - 60_000) };
  assert.doesNotThrow(() => planUndo(closed, null, { actorId: ME, now: NOW }));
  assert.equal(reasonOf(() => planUndo(closed, null, { actorId: OTHER, now: NOW })), "meeting_forbidden");
  assert.equal(reasonOf(() => planUndo({ ...closed, status: "scheduled" }, null, { actorId: ME, now: NOW })), "meeting_undo_unavailable");
  assert.equal(
    reasonOf(() => planUndo({ ...closed, outcomeAt: new Date(NOW.getTime() - UNDO_WINDOW_MS - 1) }, null, { actorId: ME, now: NOW })),
    "meeting_undo_unavailable",
  );
  assert.equal(reasonOf(() => planUndo({ ...closed, outcomeAt: null }, null, { actorId: ME, now: NOW })), "meeting_undo_unavailable");
});

test("undoing a reschedule needs the new meeting to be untouched; otherwise the chain would break", () => {
  const closed = { status: "rescheduled" as const, outcomeByBdId: ME, outcomeAt: new Date(NOW.getTime() - 1000) };
  assert.doesNotThrow(() => planUndo(closed, { status: "scheduled" }, { actorId: ME, now: NOW }));
  assert.equal(reasonOf(() => planUndo(closed, { status: "held" }, { actorId: ME, now: NOW })), "meeting_undo_unavailable");
  assert.equal(reasonOf(() => planUndo(closed, null, { actorId: ME, now: NOW })), "meeting_undo_unavailable");
});

test("the auto-created follow-up task goes away on undo only while it is open and untouched", () => {
  const created = new Date("2026-10-22T15:00:00.000Z");
  assert.equal(canRemoveFollowUpTask({ status: "open", createdAt: created, updatedAt: created }), true);
  assert.equal(canRemoveFollowUpTask({ status: "open", createdAt: created, updatedAt: new Date(created.getTime() + 30_000) }), false);
  assert.equal(canRemoveFollowUpTask({ status: "done", createdAt: created, updatedAt: created }), false);
});

test("only meeting_logged moves the contact stage; every other meeting activity is status-neutral and not a touch", () => {
  const event = (type: string) => ({ kind: "activity" as const, id: "a1", type, at: NOW });
  assert.equal(activityStageCandidate(event("meeting_logged"))?.rank, 3);
  for (const type of ["meeting_scheduled", "meeting_no_show", "meeting_cancelled", "meeting_rescheduled"]) {
    assert.equal(activityStageCandidate(event(type)), null, type);
    assert.ok((NON_TOUCH_ACTIVITY_TYPES as readonly string[]).includes(type), `${type} is not a touch`);
  }
  assert.ok(!(NON_TOUCH_ACTIVITY_TYPES as readonly string[]).includes("meeting_logged"));
});

test("the timeline shows every outcome of a meeting under the Reuniones pill, and no pill carries the bare scheduling record", () => {
  assert.deepEqual([...TIMELINE_PILL_GROUPS.meeting_logged].sort(), ["meeting_cancelled", "meeting_logged", "meeting_no_show", "meeting_rescheduled"]);
  assert.ok(!Object.values(TIMELINE_PILL_GROUPS).flat().includes("meeting_scheduled"));
});

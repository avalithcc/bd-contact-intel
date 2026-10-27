/**
 * follow-up-expiry: the "Seguimiento" property on the contact record, derived from the person's own activities and the BD's
 * latest cycle row, so the record page pays no extra round trip. Pure: the same rules the SQL (openCycle.ts) applies.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveFollowUpRecordState, type RecordCycle } from "@/lib/followUp/recordState";

const at = (iso: string) => new Date(iso);
const cycle = (over: Partial<RecordCycle> = {}): RecordCycle => ({
  cycleStartedOn: "2026-10-20",
  lastTouchAt: at("2026-10-14T12:00:00Z"),
  createdAt: at("2026-10-20T13:00:00Z"),
  ...over,
});
const act = (type: string, iso: string, metadata: Record<string, unknown> = {}, id = `${type}-${iso}`) => ({ id, type, createdAt: at(iso), metadata });

test("an open cycle reads 'in the queue since' for days 0-2 and 'Vencido' with its drop date from day 3", () => {
  const base = { cycle: cycle(), activities: [act("email_sent", "2026-10-14T12:00:00Z")], connectionLastMessageAt: null };
  assert.deepEqual(deriveFollowUpRecordState({ ...base, today: "2026-10-22" }), { kind: "in_queue", since: "2026-10-20" });
  assert.deepEqual(deriveFollowUpRecordState({ ...base, today: "2026-10-23" }), { kind: "overdue", since: "2026-10-20", expiresOn: "2026-10-30" });
});

test("day 10 reads as dropped by the system even before the job ran", () => {
  const state = deriveFollowUpRecordState({ cycle: cycle(), activities: [], connectionLastMessageAt: null, today: "2026-10-30" });
  assert.deepEqual(state, { kind: "out", by: "system", on: "2026-10-30", reason: null });
});

test("a touch after the row ends the cycle; an unanswered dial and a re-entry row do not", () => {
  const touched = [act("note", "2026-10-21T10:00:00Z")];
  assert.equal(deriveFollowUpRecordState({ cycle: cycle(), activities: touched, connectionLastMessageAt: null, today: "2026-10-23" }), null);
  const dial = [act("call_attempt", "2026-10-21T10:00:00Z"), act("follow_up_reentered", "2026-10-20T03:00:00Z")];
  assert.equal(deriveFollowUpRecordState({ cycle: cycle(), activities: dial, connectionLastMessageAt: null, today: "2026-10-23" })?.kind, "overdue");
  assert.equal(deriveFollowUpRecordState({ cycle: cycle(), activities: [], connectionLastMessageAt: at("2026-10-21T10:00:00Z"), today: "2026-10-23" }), null);
});

test("only the owner's worked set closes the cycle: a Hunter lookup or a status change keeps the Vencido, a reply or a note ends it", () => {
  const today = "2026-10-23";
  const kept = [act("hunter_lookup", "2026-10-21T10:00:00Z"), act("status_change", "2026-10-21T10:00:00Z", { status: "contacted" })];
  assert.equal(deriveFollowUpRecordState({ cycle: cycle(), activities: kept, connectionLastMessageAt: null, today })?.kind, "overdue");
  for (const type of ["reply_received", "note", "call", "meeting_logged", "email_sent", "discarded"]) {
    const closed = [act(type, "2026-10-21T10:00:00Z", { occurredAt: "2026-10-21T10:00:00Z" })];
    assert.equal(deriveFollowUpRecordState({ cycle: cycle(), activities: closed, connectionLastMessageAt: null, today }), null, type);
  }
});

test("a note deleted AFTER the cycle opened still closes it; one deleted BEFORE does not (same rule as the SQL)", () => {
  const after = [{ ...act("note", "2026-10-21T10:00:00Z"), deletedAt: at("2026-10-22T10:00:00Z") }];
  assert.equal(deriveFollowUpRecordState({ cycle: cycle(), activities: after, connectionLastMessageAt: null, today: "2026-10-23" }), null);
  const before = [{ ...act("note", "2026-10-19T10:00:00Z"), deletedAt: at("2026-10-19T11:00:00Z") }];
  assert.equal(deriveFollowUpRecordState({ cycle: cycle(), activities: before, connectionLastMessageAt: null, today: "2026-10-23" })?.kind, "overdue");
});

test("drop, then a note, then that note deleted: still out (a deleted note is not a touch for the entry clock)", () => {
  const activities = [
    act("follow_up_dropped", "2026-10-24T15:00:00Z", { reason: "not_now" }),
    { ...act("note", "2026-10-25T10:00:00Z"), deletedAt: at("2026-10-25T11:00:00Z") },
  ];
  assert.equal(deriveFollowUpRecordState({ cycle: null, activities, connectionLastMessageAt: null, today: "2026-10-26" })?.kind, "out");
  // The same note, not deleted, brings the contact back.
  const live = [activities[0]!, act("note", "2026-10-25T10:00:00Z")];
  assert.equal(deriveFollowUpRecordState({ cycle: null, activities: live, connectionLastMessageAt: null, today: "2026-10-26" }), null);
});

test("a drop by a BD or by the system makes the contact 'out' until a newer touch", () => {
  const dropped = [act("follow_up_dropped", "2026-10-24T15:00:00Z", { reason: "no_response" })];
  assert.deepEqual(deriveFollowUpRecordState({ cycle: cycle(), activities: dropped, connectionLastMessageAt: null, today: "2026-10-25" }), {
    kind: "out",
    by: "bd",
    on: "2026-10-24",
    reason: "no_response",
  });
  const expired = [act("follow_up_expired", "2026-10-30T05:30:00Z")];
  assert.equal(deriveFollowUpRecordState({ cycle: cycle(), activities: expired, connectionLastMessageAt: null, today: "2026-10-30" })?.kind, "out");
  const back = [...dropped, act("reply_received", "2026-10-26T09:00:00Z", { occurredAt: "2026-10-26T09:00:00Z" })];
  assert.equal(deriveFollowUpRecordState({ cycle: null, activities: back, connectionLastMessageAt: null, today: "2026-10-27" }), null);
});

test("a contact that was never in a cycle and never dropped shows nothing", () => {
  assert.equal(deriveFollowUpRecordState({ cycle: null, activities: [act("note", "2026-10-01T00:00:00Z")], connectionLastMessageAt: null, today: "2026-10-27" }), null);
});

test("the derivation never mutates its inputs", () => {
  const activities = [act("follow_up_dropped", "2026-10-24T15:00:00Z"), act("note", "2026-10-01T00:00:00Z")];
  const snapshot = JSON.stringify(activities);
  deriveFollowUpRecordState({ cycle: null, activities, connectionLastMessageAt: null, today: "2026-10-27" });
  assert.equal(JSON.stringify(activities), snapshot);
});

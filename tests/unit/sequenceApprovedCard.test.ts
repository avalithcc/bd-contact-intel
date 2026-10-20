/**
 * The approved card after send-now-or-schedule (mockup enviar-o-programar.html section 4): "Programado" when the BD chose the
 * moment, "Aprobado" when it follows the cadence, the same four actions on both, locked when it leaves in under 2 minutes,
 * "waiting" when it is overdue (the daily cap or a check is holding it).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { approvedMoment } from "@/lib/sequences/approvedMoment";
import { mapMemberCard, type CardFacts } from "@/lib/sequences/memberCard";
import { DEFAULT_SCHEDULE } from "@/lib/sequences/schedule";

const NOW = new Date("2026-10-19T14:42:00Z"); // Mon 10:42 Miami
const APPROVED_AT = new Date("2026-10-19T12:00:00Z"); // Mon 08:00 Miami -> cadence = Tue 9:00 Miami = 13:00Z
const CADENCE = new Date("2026-10-20T13:00:00Z");
const moment = (scheduledFor: Date | null, now = NOW) => approvedMoment({ scheduledFor, approvedAt: APPROVED_AT }, DEFAULT_SCHEDULE, now);

test("a stored moment equal to the cadence of the approval is the cadence, any other is a scheduled choice", () => {
  assert.equal(moment(CADENCE)?.mode, "cadence");
  assert.equal(moment(null)?.mode, "cadence");
  assert.equal(moment(new Date("2026-10-22T13:00:00Z"))?.mode, "scheduled");
  assert.equal(moment(new Date("2026-10-19T14:50:00Z"))?.mode, "scheduled");
});

test("phase: future, locked inside 2 minutes, overdue once it passed", () => {
  assert.equal(moment(new Date("2026-10-19T15:00:00Z"))?.phase, "future");
  assert.equal(moment(new Date("2026-10-19T14:43:30Z"))?.phase, "locked");
  assert.equal(moment(new Date("2026-10-19T14:44:00Z"))?.phase, "future"); // exactly 2 minutes: not yet locked
  assert.equal(moment(new Date("2026-10-19T14:40:00Z"))?.phase, "overdue");
});

test("no approval and no stored moment: nothing to describe", () => {
  assert.equal(approvedMoment({ scheduledFor: null, approvedAt: null }, DEFAULT_SCHEDULE, NOW), null);
});

const facts = (over: Partial<CardFacts>): CardFacts => ({ state: "approved", hasDraft: true, holdReason: null, reminderDueAt: null, florida: false, discardReason: null, ...over });
const ids = (c: ReturnType<typeof mapMemberCard>) => c.actions.map((a) => a.id);

test("scheduled card: 'Programado' badge with view, change, send now and cancel the schedule", () => {
  const c = mapMemberCard(facts({ approvedMode: "scheduled" }), NOW);
  assert.deepEqual([c.kind, c.tone], ["scheduled", "brand"]);
  assert.deepEqual(ids(c), ["viewEmail", "change", "sendNow", "cancelSchedule"]);
});

test("cadence-approved card keeps 'Aprobado' and gains change and send now next to its cancel", () => {
  const c = mapMemberCard(facts({ approvedMode: "cadence" }), NOW);
  assert.deepEqual([c.kind, c.tone], ["approved", "brand"]);
  assert.deepEqual(ids(c), ["viewEmail", "change", "sendNow", "cancel"]);
});

test("an approved card with no mode information behaves as the cadence one", () => {
  assert.equal(mapMemberCard(facts({}), NOW).kind, "approved");
});

test("read-only view of an approved card keeps only 'Ver correo'", () => {
  assert.deepEqual(ids(mapMemberCard(facts({ approvedMode: "scheduled" }), NOW, true)), ["viewEmail"]);
});

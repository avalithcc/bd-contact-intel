import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSuppressArgs, planCalendarSuppression, type CalendarBlastRadius, type CalendarPlanInput } from "@/lib/calendarNotification/plan";

const blast = (over: Partial<CalendarBlastRadius> = {}): CalendarBlastRadius => ({
  activities: 329, emailMessagePersonRows: 328, tasks: 0, meetings: 0, scheduledEmails: 0, signals: 0, linkedinScrapeJobs: 0,
  followUpQueueItems: 0, personBdConnections: 0, personIdMaps: 0, propertyHistoryRows: 0, lushaReveals: 0, duplicateCandidates: 0,
  mergeEvents: 0, sequenceMembers: 0, survivingEmailMessages: 328, activityTypes: { reply_received: 329 }, ...over,
});
const input = (over: Partial<CalendarPlanInput> = {}): CalendarPlanInput => ({ personIds: ["p1"], syncableBdIds: ["b1", "b2"], alreadyRuledBdIds: [], blast: blast(), ...over });

test("exactly one person and a syncable set plans a rule per syncing BD", () => {
  const plan = planCalendarSuppression(input());
  assert.equal(plan.kind, "ok");
  if (plan.kind === "ok") assert.deepEqual(plan.addRuleBdIds, ["b1", "b2"]);
});

test("zero or several persons refuse", () => {
  assert.match((planCalendarSuppression(input({ personIds: [] })) as { reason: string }).reason, /already removed/);
  assert.match((planCalendarSuppression(input({ personIds: ["a", "b"] })) as { reason: string }).reason, /2 persons/);
});

test("no syncable account refuses", () => {
  assert.equal(planCalendarSuppression(input({ syncableBdIds: [] })).kind, "refuse");
});

test("a sequence membership refuses (FK is NO ACTION)", () => {
  assert.match((planCalendarSuppression(input({ blast: blast({ sequenceMembers: 1 }) })) as { reason: string }).reason, /NO ACTION/);
});

test("BDs that already hold the rule are reported, not re-added; duplicates collapse", () => {
  const plan = planCalendarSuppression(input({ syncableBdIds: ["b1", "b2", "b1"], alreadyRuledBdIds: ["b2"] }));
  assert.ok(plan.kind === "ok");
  if (plan.kind === "ok") {
    assert.deepEqual(plan.addRuleBdIds, ["b1"]);
    assert.deepEqual(plan.alreadyRuledBdIds, ["b2"]);
  }
});

test("the planner never mutates its input: two calls on the same input agree", () => {
  const i = input({ syncableBdIds: ["b1", "b2", "b1"], alreadyRuledBdIds: ["b2"] });
  const snapshot = JSON.stringify(i);
  const first = planCalendarSuppression(i);
  const second = planCalendarSuppression(i);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(i), snapshot);
});

test("args: dry run by default, execute needs an actor, actor needs execute, unknown refuses", () => {
  assert.deepEqual(parseSuppressArgs([]), { execute: false, actor: null });
  assert.deepEqual(parseSuppressArgs(["--execute", "--actor=x"]), { execute: true, actor: "x" });
  assert.throws(() => parseSuppressArgs(["--execute"]), /requires --actor/);
  assert.throws(() => parseSuppressArgs(["--actor=x"]), /only makes sense/);
  assert.throws(() => parseSuppressArgs(["--force"]), /Unknown argument/);
});

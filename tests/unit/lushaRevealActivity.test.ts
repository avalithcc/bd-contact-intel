/**
 * Activity registration of `lusha_reveal` (lusha-reveal D15, spec lusha-reveal-audit).
 *
 * A paid reveal is work somebody did on a Contact, so it must keep counting as "ultima actividad",
 * but it must not move the stage, transfer ownership at the owner backfill, or reset the follow-up
 * clock. That is exactly `call_attempt`'s registration, so this file pins the two types side by side.
 * `NON_TOUCH_ACTIVITY_TYPES` is the trap: a type there has NO effective time at all and would vanish
 * from the last-activity column.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { NO_PROGRESS_ACTIVITY_TYPES } from "@/lib/activity/noProgressActivity";
import { FOLLOW_UP_ACTIVITY_TYPES } from "@/lib/followUp/activityTypes";
import { TIMELINE_PILL_GROUPS, resolveTimelinePillKey } from "@/lib/activity/timelinePills";
import { NON_TOUCH_ACTIVITY_TYPES, resolveEffectiveActivityAt } from "@/lib/contacts/effectiveActivityTime";
import { entryBody } from "@/lib/contacts/timelineEntryBody";
import { formatLastActivityLabel } from "@/lib/contacts/lastActivity";
import { buildFollowUpVerificationQuery } from "@/lib/followUp/candidateQuery";
import { t } from "@/lib/i18n/dictionaries";
import {
  STATUS_NEUTRAL_ACTIVITY_TYPES,
  activityRowToStatusEvent,
  activityStageCandidate,
  buildPersonStatusUpdates,
  deriveStatus,
  type StatusEvent,
} from "@/lib/status/deriveStatus";

const REVEAL = "lusha_reveal";
const ATTEMPT = "call_attempt";
const has = (list: readonly string[], type: string) => list.includes(type);

function timelineActivityTypes(): string[] {
  const source = readFileSync(join(__dirname, "..", "..", "src", "lib", "activity", "queries.ts"), "utf8");
  const match = source.match(/export const TIMELINE_ACTIVITY_TYPES = \[([\s\S]*?)\] as const;/);
  assert.ok(match, "TIMELINE_ACTIVITY_TYPES literal not found");
  return [...match![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

const registries: Array<[string, readonly string[]]> = [
  ["STATUS_NEUTRAL_ACTIVITY_TYPES", STATUS_NEUTRAL_ACTIVITY_TYPES],
  ["NO_PROGRESS_ACTIVITY_TYPES", NO_PROGRESS_ACTIVITY_TYPES],
  ["NON_TOUCH_ACTIVITY_TYPES", NON_TOUCH_ACTIVITY_TYPES],
  ["TIMELINE_ACTIVITY_TYPES", timelineActivityTypes()],
];

test("lusha_reveal sits in exactly the semantic lists call_attempt sits in (D15 parity)", () => {
  for (const [name, list] of registries) {
    assert.equal(has(list, REVEAL), has(list, ATTEMPT), name);
  }
});

test("lusha_reveal is in the two semantic lists and in the timeline", () => {
  assert.ok(has(STATUS_NEUTRAL_ACTIVITY_TYPES, REVEAL));
  assert.ok(has(NO_PROGRESS_ACTIVITY_TYPES, REVEAL));
  assert.ok(has(timelineActivityTypes(), REVEAL));
});

test("DELIBERATE ABSENCE: lusha_reveal is NOT in NON_TOUCH_ACTIVITY_TYPES (it would lose its effective time and vanish from the last-activity column)", () => {
  assert.equal(has(NON_TOUCH_ACTIVITY_TYPES, REVEAL), false);
  assert.equal(
    resolveEffectiveActivityAt({ id: "a", type: REVEAL, createdAt: new Date("2026-10-05T10:00:00Z"), metadata: {} })?.toISOString(),
    "2026-10-05T10:00:00.000Z",
  );
});

test("the reveal renders under the Sistema pill, not Llamadas, and a deep link resolves to it", () => {
  assert.ok(TIMELINE_PILL_GROUPS.system.includes(REVEAL));
  assert.ok(!TIMELINE_PILL_GROUPS.call.includes(REVEAL));
  assert.equal(resolveTimelinePillKey(REVEAL), "system");
});

const event = (type: string, at: string, id = type): StatusEvent => ({ kind: "activity", id, type, at: new Date(at) });

test("a reveal does not move the derived stage", () => {
  assert.equal(activityStageCandidate(event(REVEAL, "2026-10-05") as Extract<StatusEvent, { kind: "activity" }>), null);
  assert.equal(deriveStatus([event(REVEAL, "2026-10-05")]).status, "new");
  const updates = buildPersonStatusUpdates(
    ["p1"],
    [{ id: "r1", type: REVEAL, createdAt: new Date("2026-10-05T10:00:00Z"), metadata: { field: "emails", creditsCharged: 1, lushaId: "x" }, personId: "p1" }],
    [],
  );
  assert.deepEqual(updates, [{ personId: "p1", status: "new", statusActivityId: null }]);
});

test("a reveal after a reply leaves the stage where the reply put it", () => {
  const reply = event("reply_received", "2026-10-01", "reply");
  const before = deriveStatus([reply]);
  assert.equal(deriveStatus([reply, event(REVEAL, "2026-10-09")]).status, before.status);
  assert.deepEqual(deriveStatus([reply, event(REVEAL, "2026-10-09")]), before);
  assert.equal(activityRowToStatusEvent({ id: "r", type: REVEAL, createdAt: new Date("2026-10-05"), metadata: {} }).at.toISOString(), "2026-10-05T00:00:00.000Z");
});

test("the owner rule and the follow-up clock read the shared no-progress list, which carries the reveal", () => {
  assert.deepEqual([...NO_PROGRESS_ACTIVITY_TYPES], [ATTEMPT, REVEAL, "auto_reply_received", "email_bounced", ...FOLLOW_UP_ACTIVITY_TYPES]);
  const dialect = new PgDialect();
  const { sql: text, params } = dialect.sqlToQuery(buildFollowUpVerificationQuery());
  const cte = text.slice(text.indexOf("fuq_activity as ("), text.indexOf("fuq_connection as ("));
  const match = cte.match(/activity\.type not in \(([^)]*)\)/);
  assert.ok(match);
  const bound = match![1]!.split(",").map((p) => params[Number(p.trim().slice(1)) - 1]);
  assert.deepEqual(bound, [ATTEMPT, REVEAL, "auto_reply_received", "email_bounced", ...FOLLOW_UP_ACTIVITY_TYPES]);
  const ownerSource = readFileSync(join(__dirname, "..", "..", "src", "lib", "identity", "ownerRuleDb.ts"), "utf8");
  assert.match(ownerSource, /notInArray\(activity\.type, \[\.\.\.NO_PROGRESS_ACTIVITY_TYPES\]\)/);
});

test("a reveal still counts as the last activity and has its own label in es and en", () => {
  for (const locale of ["es", "en"] as const) {
    const dict = t(locale);
    const label = formatLastActivityLabel({ type: REVEAL, metadata: { field: "emails" } }, dict);
    assert.notEqual(label, dict.contactList.lastActivityStatusChanged, locale);
    assert.ok(label.length > 0);
  }
});

test("the reveal has a timeline body per field, in both locales", () => {
  for (const locale of ["es", "en"] as const) {
    const d = t(locale);
    const l = { ...d.contactRecord, leadStatuses: d.leadStatuses, meetings: d.meetings };
    assert.equal(entryBody({ type: REVEAL, visible: true, actorName: null, metadata: { field: "emails" } }, l), l.timelineLushaRevealEmail);
    assert.equal(entryBody({ type: REVEAL, visible: true, actorName: null, metadata: { field: "phones" } }, l), l.timelineLushaRevealPhone);
  }
});

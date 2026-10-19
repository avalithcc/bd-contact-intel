/**
 * An automatic inbound message (out-of-office, auto-generated notice) is its OWN activity type,
 * `auto_reply_received`, so that it is status-neutral by construction instead of by a special case
 * inside deriveStatus. A genuine reply keeps writing `reply_received` and keeps moving the stage.
 *
 * Fixtures come from the real producer (buildSyncedActivityRows), never from hand-built rows, so a
 * rename of the type in the producer breaks the consumers' tests instead of silently passing.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { NO_PROGRESS_ACTIVITY_TYPES } from "@/lib/activity/noProgressActivity";
import { isTimelineEntryVisible } from "@/lib/activity/timelineVisibility";
import { TIMELINE_PILL_GROUPS, resolveTimelinePillKey } from "@/lib/activity/timelinePills";
import { NON_TOUCH_ACTIVITY_TYPES, resolveEffectiveActivityAt } from "@/lib/contacts/effectiveActivityTime";
import { formatLastActivityLabel } from "@/lib/contacts/lastActivity";
import { entryBody } from "@/lib/contacts/timelineEntryBody";
import { groupEmailThreads, threadContextSummary } from "@/lib/contacts/emailThreads";
import { buildSyncedActivityRows, type BuildSyncedActivityRowsInput } from "@/lib/gmail/buildSyncedActivities";
import { buildFollowUpVerificationQuery } from "@/lib/followUp/candidateQuery";
import { t } from "@/lib/i18n/dictionaries";
import {
  OCCURRED_AT_ACTIVITY_TYPES,
  STATUS_NEUTRAL_ACTIVITY_TYPES,
  buildPersonStatusUpdates,
  type ActivityRowForStatus,
} from "@/lib/status/deriveStatus";

const AUTO = "auto_reply_received";
const has = (list: readonly string[], type: string) => list.includes(type);

const input = (over: Partial<BuildSyncedActivityRowsInput> = {}): BuildSyncedActivityRowsInput => ({
  gmailMessageId: "m-1",
  gmailThreadId: "th-1",
  direction: "inbound",
  fromAddress: "jane@prospect.com",
  toAddresses: ["bd@avalith.net"],
  subject: "Out of office: intro",
  sentAt: new Date("2026-10-10T12:00:00.000Z"),
  isPlatformSent: false,
  isAutomatic: false,
  matches: [{ personId: "p1", matchedEmail: "jane@prospect.com", matchConfidence: "exact" }],
  ...over,
});

/** The row exactly as the sync would persist it, shaped for the status derivation. */
function persisted(over: Partial<BuildSyncedActivityRowsInput>, id: string, createdAt: string): ActivityRowForStatus & { personId: string } {
  const [row] = buildSyncedActivityRows(input(over));
  assert.ok(row);
  return { id, type: row.type, createdAt: new Date(createdAt), metadata: row.metadata, personId: row.personId };
}

function timelineActivityTypes(): string[] {
  const source = readFileSync(join(__dirname, "..", "..", "src", "lib", "activity", "queries.ts"), "utf8");
  const match = source.match(/export const TIMELINE_ACTIVITY_TYPES = \[([\s\S]*?)\] as const;/);
  assert.ok(match);
  return [...match![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

// --- the producer ----------------------------------------------------------------------------

test("an automatic inbound message builds an auto_reply_received row, a genuine one still builds reply_received", () => {
  assert.equal(buildSyncedActivityRows(input({ isAutomatic: true }))[0]?.type, AUTO);
  assert.equal(buildSyncedActivityRows(input({ isAutomatic: false }))[0]?.type, "reply_received");
});

test("the automatic row keeps the reply_received metadata shape, so every reader of subject/from/occurredAt works unchanged", () => {
  const auto = buildSyncedActivityRows(input({ isAutomatic: true }))[0]!;
  const genuine = buildSyncedActivityRows(input({ isAutomatic: false }))[0]!;
  assert.deepEqual(auto.metadata, genuine.metadata);
});

test("the automatic flag changes nothing on outbound mail: we never log our own send as an auto-reply", () => {
  const rows = buildSyncedActivityRows(input({ direction: "outbound", isAutomatic: true, fromAddress: "bd@avalith.net", toAddresses: ["jane@prospect.com"] }));
  assert.equal(rows[0]?.type, "email_sent");
});

test("the planner never mutates its input and is stable across two calls", () => {
  const i = input({ isAutomatic: true });
  const snapshot = JSON.stringify(i);
  const first = buildSyncedActivityRows(i);
  const second = buildSyncedActivityRows(i);
  assert.equal(JSON.stringify(i), snapshot);
  assert.deepEqual(first, second);
});

// --- status: neutral by construction, genuine replies unchanged -------------------------------

test("an auto-reply after our email leaves the Contact 'contacted' (it stays in the follow-up queue)", () => {
  const sent = { id: "s", type: "email_sent", createdAt: new Date("2026-10-09T09:00:00Z"), metadata: {}, personId: "p1" };
  const auto = persisted({ isAutomatic: true }, "a", "2026-10-10T12:00:05Z");
  assert.deepEqual(buildPersonStatusUpdates(["p1"], [sent, auto], []), [{ personId: "p1", status: "contacted", statusActivityId: "s" }]);
});

test("REGRESSION: a genuine reply still moves the stage to 'replied', exactly as before", () => {
  const sent = { id: "s", type: "email_sent", createdAt: new Date("2026-10-09T09:00:00Z"), metadata: {}, personId: "p1" };
  const genuine = persisted({ isAutomatic: false, subject: "Re: intro" }, "g", "2026-10-10T12:00:05Z");
  assert.equal(genuine.type, "reply_received");
  assert.deepEqual(buildPersonStatusUpdates(["p1"], [sent, genuine], []), [{ personId: "p1", status: "replied", statusActivityId: "g" }]);
});

test("a genuine reply AFTER an auto-reply is what moves the stage", () => {
  const auto = persisted({ isAutomatic: true }, "a", "2026-10-10T12:00:05Z");
  const genuine = persisted({ isAutomatic: false, gmailMessageId: "m-2", subject: "Re: intro" }, "g", "2026-10-20T08:00:00Z");
  assert.equal(buildPersonStatusUpdates(["p1"], [auto, genuine], [])[0]?.status, "replied");
});

// --- registries -------------------------------------------------------------------------------

test("registered as status-neutral and no-progress, in the timeline, and deliberately NOT a non-touch", () => {
  assert.ok(has(STATUS_NEUTRAL_ACTIVITY_TYPES, AUTO));
  assert.ok(has(NO_PROGRESS_ACTIVITY_TYPES, AUTO));
  assert.ok(has(timelineActivityTypes(), AUTO));
  assert.equal(has(NON_TOUCH_ACTIVITY_TYPES, AUTO), false);
});

test("it is dated by the message (metadata.occurredAt), not by when the sync ran", () => {
  assert.ok(has(OCCURRED_AT_ACTIVITY_TYPES, AUTO));
  const row = persisted({ isAutomatic: true }, "a", "2026-10-15T00:00:00Z");
  assert.equal(resolveEffectiveActivityAt(row)?.toISOString(), "2026-10-10T12:00:00.000Z");
});

test("the follow-up clock excludes it: the shared no-progress list is what the queue binds", () => {
  const { sql: text, params } = new PgDialect().sqlToQuery(buildFollowUpVerificationQuery());
  const cte = text.slice(text.indexOf("fuq_activity as ("), text.indexOf("fuq_connection as ("));
  const match = cte.match(/activity\.type not in \(([^)]*)\)/);
  assert.ok(match);
  const bound = match![1]!.split(",").map((p) => params[Number(p.trim().slice(1)) - 1]);
  assert.ok(bound.includes(AUTO));
});

test("the queue still lists 'contacted' contacts, which is what keeps the person in the cadence", () => {
  const src = readFileSync(join(__dirname, "..", "..", "src", "lib", "followUp", "candidateQuery.ts"), "utf8");
  assert.match(src, /person\.status in \('contacted', 'replied'\)/);
});

// --- privacy and presentation ----------------------------------------------------------------

test("another BD's auto-reply is as private as their genuine reply (it carries the same subject and address)", () => {
  assert.equal(isTimelineEntryVisible({ type: AUTO, actorBdId: "bd-a" }, "bd-b"), false);
  assert.equal(isTimelineEntryVisible({ type: AUTO, actorBdId: "bd-a" }, "bd-a"), true);
  const src = readFileSync(join(__dirname, "..", "..", "src", "lib", "activity", "lockedConversationSummaries.ts"), "utf8");
  assert.match(src, /CONVERSATION_TYPES: string\[\] = \[[^\]]*"auto_reply_received"/);
});

test("it renders under the Correos pill with the replies and joins a thread as an inbound message", () => {
  assert.ok(TIMELINE_PILL_GROUPS.email_sent.includes(AUTO));
  assert.equal(resolveTimelinePillKey(AUTO), "email_sent");
  const mk = (id: string, type: string, at: string) => ({ id, type, createdAt: new Date(at), metadata: { gmailThreadId: "th-1", matchedEmail: "jane@prospect.com" }, visible: true });
  const [threaded] = groupEmailThreads([mk("1", "email_sent", "2026-10-09"), mk("2", AUTO, "2026-10-10")]);
  assert.equal(threaded?.kind, "thread");
  if (threaded?.kind === "thread") assert.equal(threadContextSummary(threaded.group).direction, "inbound");
});

test("the card reads as an automatic reply, not 'respondio', in both locales", () => {
  for (const locale of ["es", "en"] as const) {
    const d = t(locale);
    const l = { ...d.contactRecord, leadStatuses: d.leadStatuses, meetings: d.meetings };
    assert.equal(entryBody({ type: AUTO, visible: true, actorName: null, metadata: {} }, l), l.timelineAutoReplyDefault);
    assert.equal(entryBody({ type: AUTO, visible: true, actorName: null, metadata: { subject: "Out of office", from: "jane@prospect.com" } }, l), "Out of office · jane@prospect.com");
    assert.notEqual(l.timelineFilterAutoReply, l.timelineFilterReplyReceived);
    const label = formatLastActivityLabel({ type: AUTO, metadata: {} }, d);
    assert.equal(label, d.contactList.lastActivityAutoReply);
    assert.notEqual(label, d.contactList.lastActivityReplyReceived);
  }
  assert.equal(t("es").contactRecord.timelineFilterAutoReply, "Respuesta automática");
  assert.equal(t("en").contactRecord.timelineFilterAutoReply, "Automatic reply");
});

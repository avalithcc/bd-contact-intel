/**
 * Pure grouping behind the admin's inline conversation read
 * (src/lib/activity/inlineConversationGroups.ts). The DB read feeds it rows
 * newest-first, capped at limit + 1 so "there was more" is knowable.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { groupInlineRows, inlineEmailBody, unlistedMailToEntry, isTimelineEmpty, type InlineRow } from "@/lib/activity/inlineConversationGroups";

const at = (n: number) => new Date(Date.UTC(2026, 9, n));
const email = (ref: string, group: string, day: number): InlineRow => ({
  kind: "email", bdId: "bd-a", group, ref, at: at(day), who: "Ana", body: `body ${ref}`, truncated: false,
  direction: "outbound", subject: `subj ${ref}`, addr: "x@y.test", orphan: false,
});
const linkedin = (ref: string, bdId: string, day: number): InlineRow => ({
  kind: "linkedin", bdId, group: `conv-${bdId}`, ref, at: at(day), who: "Ana", body: `msg ${ref}`, truncated: false,
  direction: null, subject: null, addr: null, orphan: false,
});

test("email bodies are keyed thread then message, read back through the same key builder", () => {
  const out = groupInlineRows([email("m2", "t1", 3), email("m1", "t1", 2)], 10);
  assert.equal(inlineEmailBody(out.emailBodies, "t1", "m1")?.bodyText, "body m1");
  assert.equal(inlineEmailBody(out.emailBodies, "t1", "missing"), undefined);
  assert.equal(inlineEmailBody(out.emailBodies, "nope", "m1"), undefined);
});

test("linkedin messages are grouped per BD in chronological order (rows arrive newest first)", () => {
  const out = groupInlineRows([linkedin("c", "bd-a", 3), linkedin("b", "bd-b", 2), linkedin("a", "bd-a", 1)], 10);
  assert.deepEqual(out.linkedin["bd-a"]!.map((m) => m.id), ["a", "c"]);
  assert.deepEqual(out.linkedin["bd-b"]!.map((m) => m.id), ["b"]);
  assert.equal(out.capped, false);
});

test("more rows than the limit keeps the newest ones and reports capped", () => {
  const out = groupInlineRows([linkedin("c", "bd-a", 3), linkedin("b", "bd-a", 2), linkedin("a", "bd-a", 1)], 2);
  assert.equal(out.capped, true);
  assert.deepEqual(out.linkedin["bd-a"]!.map((m) => m.id), ["b", "c"]);
});

test("grouping never mutates its input: two calls with the same rows agree", () => {
  const rows = [linkedin("c", "bd-a", 3), linkedin("a", "bd-a", 1), email("m1", "t1", 2)];
  const snapshot = JSON.stringify(rows);
  const first = groupInlineRows(rows, 10);
  const second = groupInlineRows(rows, 10);
  assert.equal(JSON.stringify(rows), snapshot);
  assert.deepEqual(first, second);
});

test("only messages with no activity row come back as unlisted mail, oldest first, and become timeline entries", () => {
  const rows: InlineRow[] = [
    { ...email("m3", "t2", 4), orphan: true, direction: "inbound", addr: "jane@y.test" },
    email("m2", "t1", 3),
    { ...email("m1", "t1", 2), orphan: true },
  ];
  const out = groupInlineRows(rows, 10);
  assert.deepEqual(out.unlistedMail.map((m) => m.gmailMessageId), ["m1", "m3"]);
  const [sent, received] = out.unlistedMail.map(unlistedMailToEntry);
  assert.equal(sent!.type, "email_sent");
  assert.equal(sent!.visible, true);
  assert.equal(sent!.actorName, "Ana");
  assert.deepEqual(sent!.metadata?.to, ["x@y.test"]);
  assert.equal(sent!.metadata?.gmailThreadId, "t1");
  assert.equal(received!.type, "reply_received");
  assert.equal(received!.metadata?.from, "jane@y.test");
  // The body is still reachable through the same key the thread card uses.
  assert.equal(inlineEmailBody(out.emailBodies, "t2", "m3")?.bodyText, "body m3");
});

test("a contact with ONLY unlisted mail is not empty: the admin must not see the no-activity state", () => {
  assert.equal(isTimelineEmpty({ entries: 0, upcoming: 0, unlisted: 1 }), false);
  assert.equal(isTimelineEmpty({ entries: 0, upcoming: 0, unlisted: 0 }), true);
  assert.equal(isTimelineEmpty({ entries: 1, upcoming: 0, unlisted: 0 }), false);
  assert.equal(isTimelineEmpty({ entries: 0, upcoming: 2, unlisted: 0 }), false);
});

/**
 * Dry-run planner for the historical damage: Contacts wrongly marked `replied` because an
 * out-of-office was written as `reply_received` before auto_reply_received existed. Migration 0044
 * defaulted every old email_message to is_automatic = false, so the only surviving signal is the
 * stored subject, read through the SAME prefix rule the live detector uses.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSyncedActivityRows } from "@/lib/gmail/buildSyncedActivities";
import { automaticSubjectPrefix, hasAutomaticSubjectPrefix, isAutomatedMessage } from "@/lib/gmail/automatedMessage";
import { planAutoReplyDamage } from "@/lib/gmail/autoReplyBackfill";
import type { ActivityRowForStatus, ConnectionRowForStatus } from "@/lib/status/deriveStatus";

// A row exactly as the sync wrote it BEFORE the change: inbound, isAutomatic false, whatever the subject.
function historicReply(personId: string, id: string, subject: string | null, at: string): ActivityRowForStatus & { personId: string } {
  const [row] = buildSyncedActivityRows({
    gmailMessageId: `g-${id}`, gmailThreadId: "t", direction: "inbound", fromAddress: "x@y.com", toAddresses: ["bd@avalith.net"],
    subject, sentAt: new Date(at), isPlatformSent: false, isAutomatic: false,
    matches: [{ personId, matchedEmail: "x@y.com", matchConfidence: "exact" }],
  });
  return { id, type: row!.type, createdAt: new Date(at), metadata: row!.metadata, personId };
}
const sent = (personId: string, id: string, at: string): ActivityRowForStatus & { personId: string } => ({ id, type: "email_sent", createdAt: new Date(at), metadata: {}, personId });
const person = (personId: string, status = "replied") => ({ personId, status });

test("the subject rule is the live detector's rule: one function, no second copy", () => {
  assert.equal(hasAutomaticSubjectPrefix("Out of office: intro"), true);
  assert.equal(hasAutomaticSubjectPrefix("Automatic reply: intro"), true);
  assert.equal(hasAutomaticSubjectPrefix("Re: out of office coverage"), false);
  assert.equal(hasAutomaticSubjectPrefix(null), false);
  assert.equal(isAutomatedMessage([{ name: "Subject", value: "Out of office: intro" }], "text/plain"), true);
});

test("a Contact whose only reply is an out-of-office is counted, with the stage it would fall back to", () => {
  const plan = planAutoReplyDamage([person("p1")], [sent("p1", "s1", "2026-10-01"), historicReply("p1", "r1", "Out of office: intro", "2026-10-02")], []);
  assert.equal(plan.affected.length, 1);
  assert.deepEqual(plan.affected[0], { personId: "p1", wouldBecome: "contacted", prefixes: ["out of office"] });
});

test("a Contact with a genuine reply as well keeps replied and is NOT counted as damaged", () => {
  const plan = planAutoReplyDamage(
    [person("p1")],
    [sent("p1", "s1", "2026-10-01"), historicReply("p1", "r1", "Out of office: intro", "2026-10-02"), historicReply("p1", "r2", "Re: intro", "2026-10-09")],
    [],
  );
  assert.equal(plan.affected.length, 0);
  assert.equal(plan.alsoHasOtherEvidence, 1);
});

test("replied evidence from a connection or a connected call also keeps the stage", () => {
  const conn: ConnectionRowForStatus & { personId: string } = { bdId: "b", sentCount: 1, receivedCount: 1, lastMessageAt: new Date("2026-09-01"), personId: "p1" };
  const call = { id: "c1", type: "call", createdAt: new Date("2026-10-03"), metadata: { outcome: "connected", direction: "outbound" }, personId: "p2" };
  const plan = planAutoReplyDamage(
    [person("p1"), person("p2")],
    [historicReply("p1", "r1", "Out of office", "2026-10-02"), historicReply("p2", "r2", "Out of office", "2026-10-02"), call],
    [conn],
  );
  assert.equal(plan.affected.length, 0);
  assert.equal(plan.alsoHasOtherEvidence, 2);
});

test("a Contact not currently replied, or with a non-OOO reply subject, is ignored", () => {
  const plan = planAutoReplyDamage(
    [person("p1", "contacted"), person("p2")],
    [historicReply("p1", "r1", "Out of office", "2026-10-02"), historicReply("p2", "r2", "Re: out of office coverage", "2026-10-02")],
    [],
  );
  assert.equal(plan.affected.length, 0);
  assert.equal(plan.alsoHasOtherEvidence, 0);
});

test("a null or missing subject is never an out-of-office", () => {
  assert.equal(planAutoReplyDamage([person("p1")], [historicReply("p1", "r1", null, "2026-10-02")], []).affected.length, 0);
});

test("the planner does not mutate its input and gives the same plan twice", () => {
  const rows = [sent("p1", "s1", "2026-10-01"), historicReply("p1", "r1", "Automatic reply: hi", "2026-10-02")];
  const snapshot = JSON.stringify(rows);
  const first = planAutoReplyDamage([person("p1")], rows, []);
  const second = planAutoReplyDamage([person("p1")], rows, []);
  assert.equal(JSON.stringify(rows), snapshot);
  assert.deepEqual(first, second);
  assert.equal(rows[1]!.type, "reply_received");
});

test("PRIVACY: only the matched prefix leaves the planner, never the rest of the subject (it can carry a person's name)", () => {
  const subject = "Automatic reply: Intro Avalith / Jane Doe";
  assert.equal(automaticSubjectPrefix(subject), "automatic reply");
  assert.equal(automaticSubjectPrefix("Re: out of office coverage"), null);
  assert.equal(automaticSubjectPrefix("Out of the Office - Jane Doe"), "out of the office");
  const plan = planAutoReplyDamage([person("p1")], [historicReply("p1", "r1", subject, "2026-10-02")], []);
  assert.deepEqual(plan.affected[0]?.prefixes, ["automatic reply"]);
  assert.equal(JSON.stringify(plan).includes("Jane"), false);
});

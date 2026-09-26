import assert from "node:assert/strict";
import { test } from "node:test";
import { groupEmailThreads } from "@/lib/contacts/emailThreads";

test("a lone email_sent row with a threadId stays a 'single' (no badge for 1 message)", () => {
  const entry = {
    id: "a1",
    type: "email_sent",
    createdAt: new Date("2026-10-13T09:12:00Z"),
    metadata: { gmailThreadId: "t1" },
    visible: true,
  };
  const result = groupEmailThreads([entry]);
  assert.deepEqual(result, [{ kind: "single", entry }]);
});

test("two email_sent rows sharing a threadId become one 'thread', oldest-first", () => {
  const a = {
    id: "a1",
    type: "email_sent",
    createdAt: new Date("2026-10-14T00:00:00Z"),
    metadata: { gmailThreadId: "t1" },
    visible: true,
  };
  const b = {
    id: "a2",
    type: "email_sent",
    createdAt: new Date("2026-10-13T09:12:00Z"),
    metadata: { gmailThreadId: "t1" },
    visible: true,
  };
  const result = groupEmailThreads([a, b]);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "thread");
  if (result[0].kind === "thread") {
    assert.deepEqual(result[0].group.messages.map((m) => m.id), ["a2", "a1"]);
    assert.deepEqual(result[0].group.latestAt, a.createdAt);
  }
});

test("entries with no gmailThreadId, or a non-email_sent type, pass through as 'single'", () => {
  const note = { id: "n1", type: "note", createdAt: new Date(), metadata: { note: "x" }, visible: true };
  const bareEmail = { id: "a1", type: "email_sent", createdAt: new Date(), metadata: {}, visible: true };
  const result = groupEmailThreads([note, bareEmail]);
  assert.deepEqual(result, [
    { kind: "single", entry: note },
    { kind: "single", entry: bareEmail },
  ]);
});

test("a thread is 'visible' if at least one of its messages is", () => {
  const a = {
    id: "a1",
    type: "email_sent",
    createdAt: new Date("2026-10-14T00:00:00Z"),
    metadata: { gmailThreadId: "t1" },
    visible: false,
  };
  const b = {
    id: "a2",
    type: "email_sent",
    createdAt: new Date("2026-10-13T00:00:00Z"),
    metadata: { gmailThreadId: "t1" },
    visible: true,
  };
  const result = groupEmailThreads([a, b]);
  assert.equal(result[0].kind, "thread");
  if (result[0].kind === "thread") assert.equal(result[0].group.visible, true);
});

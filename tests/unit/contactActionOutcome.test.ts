/**
 * Unit tests for src/lib/contacts/actionOutcome.ts — the seam that turns a
 * THROWN server action (dropped connection, HTTP 500) into the same typed
 * `{ ok: false }` result the record page already renders, and the note +
 * follow-up task sequencing that must never confirm a write that did not
 * happen (launch-readiness findings F1 and F2).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { saveNoteWithFollowUp, settleAction } from "@/lib/contacts/actionOutcome";

const OK = { ok: true } as const;
const boom = () => Promise.reject(new Error("network"));

test("settleAction passes a normal result through untouched", async () => {
  assert.deepEqual(await settleAction(async () => OK), OK);
  assert.deepEqual(await settleAction(async () => ({ ok: false, reason: "not_found" }) as const), {
    ok: false,
    reason: "not_found",
  });
});

test("settleAction turns a throw into 'unconfirmed' instead of rejecting", async () => {
  assert.deepEqual(await settleAction(boom), { ok: false, reason: "unconfirmed" });
});

test("note only: saved", async () => {
  const calls: string[] = [];
  const out = await saveNoteWithFollowUp({
    noteAlreadySaved: false,
    followUpTitle: "",
    saveNote: async () => (calls.push("note"), OK),
    saveFollowUp: async () => (calls.push("task"), OK),
  });
  assert.deepEqual(out, { kind: "saved" });
  assert.deepEqual(calls, ["note"]);
});

test("note + task: both written, in order", async () => {
  const calls: string[] = [];
  const out = await saveNoteWithFollowUp({
    noteAlreadySaved: false,
    followUpTitle: "Call Monday",
    saveNote: async () => (calls.push("note"), OK),
    saveFollowUp: async (t) => (calls.push(`task:${t}`), OK),
  });
  assert.deepEqual(out, { kind: "saved" });
  assert.deepEqual(calls, ["note", "task:Call Monday"]);
});

test("note fails: the task is never attempted", async () => {
  const calls: string[] = [];
  const out = await saveNoteWithFollowUp({
    noteAlreadySaved: false,
    followUpTitle: "x",
    saveNote: async () => ({ ok: false, reason: "merged" }),
    saveFollowUp: async () => (calls.push("task"), OK),
  });
  assert.deepEqual(out, { kind: "note_failed", reason: "merged" });
  assert.deepEqual(calls, []);
});

test("note write throws: reported as note_failed/unconfirmed, task not attempted", async () => {
  const out = await saveNoteWithFollowUp({
    noteAlreadySaved: false,
    followUpTitle: "x",
    saveNote: boom,
    saveFollowUp: async () => OK,
  });
  assert.deepEqual(out, { kind: "note_failed", reason: "unconfirmed" });
});

test("task returns {ok:false}: partial success is reported, never 'saved'", async () => {
  const out = await saveNoteWithFollowUp({
    noteAlreadySaved: false,
    followUpTitle: "x",
    saveNote: async () => OK,
    saveFollowUp: async () => ({ ok: false, reason: "unexpected" }),
  });
  assert.deepEqual(out, { kind: "follow_up_failed", reason: "unexpected" });
});

test("task throws: partial success is reported, never 'saved'", async () => {
  const out = await saveNoteWithFollowUp({
    noteAlreadySaved: false,
    followUpTitle: "x",
    saveNote: async () => OK,
    saveFollowUp: boom,
  });
  assert.deepEqual(out, { kind: "follow_up_failed", reason: "unconfirmed" });
});

test("retry after a partial success writes ONLY the task, never the note again", async () => {
  const calls: string[] = [];
  const out = await saveNoteWithFollowUp({
    noteAlreadySaved: true,
    followUpTitle: "x",
    saveNote: async () => (calls.push("note"), OK),
    saveFollowUp: async () => (calls.push("task"), OK),
  });
  assert.deepEqual(out, { kind: "saved" });
  assert.deepEqual(calls, ["task"]);
});

test("a blank follow-up title means no task is written", async () => {
  const calls: string[] = [];
  await saveNoteWithFollowUp({
    noteAlreadySaved: false,
    followUpTitle: "   ",
    saveNote: async () => (calls.push("note"), OK),
    saveFollowUp: async () => (calls.push("task"), OK),
  });
  assert.deepEqual(calls, ["note"]);
});

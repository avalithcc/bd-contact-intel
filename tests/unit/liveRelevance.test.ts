import assert from "node:assert/strict";
import { test } from "node:test";
import { debounceMsFor, isRelevant, parseChange, type LiveChange } from "@/lib/shell/liveRelevance";

const change = (kind: string, ids: LiveChange["ids"] = {}, extra: Partial<LiveChange> = {}): LiveChange => ({ kind, op: "INSERT", ids, bulk: false, ...extra });

test("parseChange reads the trigger payload and rejects anything else", () => {
  assert.deepEqual(parseChange({ kind: "activity", op: "INSERT", ids: { personId: ["p1"] }, bdId: "b1" }), { kind: "activity", op: "INSERT", ids: { personId: ["p1"] }, bulk: false });
  assert.deepEqual(parseChange({ kind: "task", op: "UPDATE", bulk: true, count: 900 }), { kind: "task", op: "UPDATE", ids: {}, bulk: true });
  for (const bad of [null, undefined, 3, "x", {}, { kind: 4 }, { kind: "task", op: "INSERT", ids: { personId: "not-an-array" } }]) assert.equal(parseChange(bad), null, JSON.stringify(bad));
});

test("a contact record reacts only to its own person, across every kind that feeds it", () => {
  const path = "/contacts/p1";
  for (const kind of ["activity", "task", "meeting", "scheduled_email", "sequence_member", "sequence_draft", "person"]) {
    assert.equal(isRelevant(change(kind, { personId: ["p1", "p2"] }), path), true, kind);
    assert.equal(isRelevant(change(kind, { personId: ["p2"] }), path), false, `${kind} of another contact`);
  }
  assert.equal(isRelevant(change("follow_up_queue_item", { personId: ["p1"] }), path), false);
  assert.equal(isRelevant(change("activity", { personId: ["p2"] }, { bulk: true }), path), true, "a bulk message cannot be narrowed, so it is relevant");
  assert.equal(isRelevant(change("activity", { companyKey: ["acme.com"] }), path), false);
});

test("a company record reacts only to its own company key", () => {
  const path = "/companies/acme.com";
  for (const kind of ["activity", "task", "person", "company"]) {
    assert.equal(isRelevant(change(kind, { companyKey: ["acme.com"] }), path), true, kind);
    assert.equal(isRelevant(change(kind, { companyKey: ["other.com"] }), path), false, kind);
  }
  assert.equal(isRelevant(change("person", { companyKey: ["acme.com"] }), "/companies/acme%2Ecom"), true, "the encoded route key is decoded");
  assert.equal(isRelevant(change("meeting", { personId: ["p1"] }), path), false);
});

test("list and queue screens react to the kinds that feed them", () => {
  const cases: [string, string[], string[]][] = [
    ["/contacts", ["person", "activity", "company", "task"], ["meeting", "scheduled_email", "sequence"]],
    ["/follow-ups", ["follow_up_queue_item", "activity", "task", "person"], ["meeting", "company"]],
    ["/tasks", ["task"], ["activity", "meeting"]],
    ["/reuniones", ["meeting"], ["task", "activity"]],
    ["/scheduled", ["scheduled_email"], ["meeting", "task"]],
    ["/sequences", ["sequence", "sequence_member", "sequence_draft"], ["task", "activity"]],
    ["/admin/gmail", ["email_account", "scheduled_email", "activity"], ["meeting", "task"]],
    ["/admin/reports", ["activity", "meeting", "task", "scheduled_email", "person", "company", "sequence_member"], ["email_account", "sequence_draft"]],
    ["/companies", ["company", "person"], ["task", "meeting"]],
  ];
  for (const [path, yes, no] of cases) {
    for (const kind of yes) assert.equal(isRelevant(change(kind), path), true, `${path} <- ${kind}`);
    for (const kind of no) assert.equal(isRelevant(change(kind), path), false, `${path} <- ${kind}`);
  }
});

test("a sequence detail reacts only to its own sequence", () => {
  const path = "/sequences/s1";
  assert.equal(isRelevant(change("sequence_draft", { sequenceId: ["s1"], personId: ["p1"] }), path), true);
  assert.equal(isRelevant(change("sequence", { sequenceId: ["s2"] }), path), false);
  assert.equal(isRelevant(change("sequence_member", { sequenceId: ["s2"] }, { bulk: true }), path), true);
  assert.equal(isRelevant(change("task"), path), false);
});

test("screens that nothing feeds ignore every message", () => {
  for (const path of ["/", "/whats-new", "/account/email", "/playbook", "/unknown"]) assert.equal(isRelevant(change("activity", { personId: ["p1"] }), path), false, path);
});

test("the heavy reports screen waits longer than the rest", () => {
  assert.ok(debounceMsFor("/admin/reports") > debounceMsFor("/tasks"));
  assert.equal(debounceMsFor("/tasks"), 400);
});

test("isRelevant does not mutate the change", () => {
  const c = Object.freeze(change("task", Object.freeze({ personId: Object.freeze(["p1"]) as string[] })));
  assert.equal(isRelevant(c, "/contacts/p1"), isRelevant(c, "/contacts/p1"));
});

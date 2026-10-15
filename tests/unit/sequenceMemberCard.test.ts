import assert from "node:assert/strict";
import { test } from "node:test";
import { MEMBER_STATES } from "@/lib/sequences/memberState";
import { HOLD_REASONS } from "@/lib/sequences/preSendChecks";
import { mapMemberCard, type CardFacts } from "@/lib/sequences/memberCard";

const NOW = new Date("2026-10-15T14:00:00Z"); // 10:00 in Miami

const facts = (over: Partial<CardFacts>): CardFacts => ({
  state: "drafted",
  hasDraft: true,
  holdReason: null,
  reminderDueAt: null,
  florida: false,
  discardReason: null,
  ...over,
});
const ids = (c: ReturnType<typeof mapMemberCard>) => c.actions.map((a) => a.id);

test("drafted: info badge, Florida outline, review + approve, and the three-item menu", () => {
  const c = mapMemberCard(facts({ state: "drafted", florida: true }), NOW);
  assert.deepEqual([c.kind, c.tone, c.florida], ["draft", "info", true]);
  assert.deepEqual(c.actions, [
    { id: "reviewDraft", style: "secondary" },
    { id: "approve", style: "primary" },
  ]);
  assert.deepEqual(c.menu, ["regenerate", "openContact", "remove"]);
});

test("the Florida outline is a drafted-only badge, as in the mockup", () => {
  for (const state of ["approved", "sent", "replied", "discarded"] as const) {
    assert.equal(mapMemberCard(facts({ state, florida: true }), NOW).florida, false, state);
  }
});

test("approved: brand badge, view the email or cancel the send", () => {
  const c = mapMemberCard(facts({ state: "approved" }), NOW);
  assert.deepEqual([c.kind, c.tone], ["approved", "brand"]);
  assert.deepEqual(c.actions, [
    { id: "viewEmail", style: "ghost" },
    { id: "cancel", style: "secondary" },
  ]);
});

test("sent, reminder not yet due: contacted badge, view sent or bring the reminder forward", () => {
  const c = mapMemberCard(facts({ state: "sent", reminderDueAt: new Date("2026-10-17T13:00:00Z") }), NOW);
  assert.deepEqual([c.kind, c.tone], ["sent", "contacted"]);
  assert.deepEqual(c.actions, [
    { id: "viewSent", style: "ghost" },
    { id: "advanceReminder", style: "secondary" },
  ]);
});

test("sent, reminder due today: warn badge 'Recordatorio hoy', review the reminder or approve it", () => {
  const c = mapMemberCard(facts({ state: "sent", reminderDueAt: new Date("2026-10-15T13:00:00Z") }), NOW);
  assert.deepEqual([c.kind, c.tone], ["reminderToday", "warn"]);
  assert.deepEqual(c.actions, [
    { id: "reviewReminder", style: "secondary" },
    { id: "approve", style: "primary" },
  ]);
});

test("an overdue reminder is still due; a reminder due tomorrow in Miami is not", () => {
  assert.equal(mapMemberCard(facts({ state: "sent", reminderDueAt: new Date("2026-10-12T13:00:00Z") }), NOW).kind, "reminderToday");
  assert.equal(mapMemberCard(facts({ state: "sent", reminderDueAt: new Date("2026-10-16T13:00:00Z") }), NOW).kind, "sent");
});

test("'today' is the Miami calendar day, not the UTC one", () => {
  // 03:00 UTC on the 16th is still 23:00 on the 15th in Miami, so a reminder at 09:00 Miami on the 16th is tomorrow.
  const lateNight = new Date("2026-10-16T03:00:00Z");
  const due = new Date("2026-10-16T13:00:00Z");
  assert.equal(mapMemberCard(facts({ state: "sent", reminderDueAt: due }), lateNight).kind, "sent");
});

test("a sent member with no reminder date is never 'Recordatorio hoy'", () => {
  assert.equal(mapMemberCard(facts({ state: "sent", reminderDueAt: null }), NOW).kind, "sent");
});

test("replied: replied badge, only the conversation; no approve, no reminder", () => {
  const c = mapMemberCard(facts({ state: "replied", reminderDueAt: new Date("2026-10-15T13:00:00Z") }), NOW);
  assert.deepEqual([c.kind, c.tone], ["replied", "replied"]);
  assert.deepEqual(c.actions, [{ id: "openConversation", style: "primary" }]);
  // sequence-compliance: the card MUST offer "No contactar", and phrase detection "MUST NOT be the only path to
  // suppression" — so this cannot depend on the advisory prompt, which only appears when a phrase is detected.
  assert.deepEqual(c.menu, ["optOut", "openContact"]);
});

test("discarded: discarded badge and 'Reincorporar'", () => {
  const c = mapMemberCard(facts({ state: "discarded", discardReason: "no_title" }), NOW);
  assert.deepEqual([c.kind, c.tone], ["discarded", "discarded"]);
  assert.deepEqual(ids(c), ["readmit"]);
});

test("an opted-out member offers no 'Reincorporar': the state machine forbids it", () => {
  assert.deepEqual(ids(mapMemberCard(facts({ state: "discarded", discardReason: "opt_out" }), NOW)), []);
});

test("every hold reason reaches the card, in every state", () => {
  for (const state of MEMBER_STATES) {
    for (const holdReason of HOLD_REASONS) {
      assert.equal(mapMemberCard(facts({ state, holdReason }), NOW).holdReason, holdReason, `${state}/${holdReason}`);
    }
  }
});

test("a held approved member can still be cancelled", () => {
  assert.deepEqual(ids(mapMemberCard(facts({ state: "approved", holdReason: "sync_stale" }), NOW)), ["viewEmail", "cancel"]);
});

test("a drafted member with no draft offers neither review nor approve", () => {
  const c = mapMemberCard(facts({ state: "drafted", hasDraft: false }), NOW);
  assert.equal(c.kind, "noDraft");
  assert.deepEqual(c.actions, []);
  assert.deepEqual(c.menu, ["openContact", "remove"]);
});

test("no_reply: the sent email can be read; nothing can be approved", () => {
  const c = mapMemberCard(facts({ state: "no_reply" }), NOW);
  assert.equal(c.kind, "noReply");
  assert.deepEqual(ids(c), ["viewSent"]);
});

test("no state other than drafted or a due reminder ever offers approve", () => {
  for (const state of MEMBER_STATES.filter((s) => s !== "drafted")) {
    const c = mapMemberCard(facts({ state, reminderDueAt: new Date("2099-01-01T00:00:00Z") }), NOW);
    assert.ok(!ids(c).includes("approve"), state);
  }
});

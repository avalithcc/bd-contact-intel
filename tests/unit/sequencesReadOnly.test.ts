import assert from "node:assert/strict";
import { test } from "node:test";
import { MEMBER_STATES } from "@/lib/sequences/memberState";
import { cardStep } from "@/lib/sequences/detailFlow";
import { mapMemberCard, type CardFacts } from "@/lib/sequences/memberCard";
import { isReadOnlyAction, isReadOnlyView } from "@/lib/sequences/readOnly";
import { reviewView } from "@/lib/sequences/reviewDialog";
import type { DetailDraft, DetailMember } from "@/lib/sequences/detailQueries";
import { DEFAULT_SCHEDULE } from "@/lib/sequences/schedule";
import { en } from "@/lib/i18n/dictionaries/en";
import { es } from "@/lib/i18n/dictionaries/es";

const NOW = new Date("2026-10-15T14:00:00Z");
const facts = (over: Partial<CardFacts>): CardFacts => ({ state: "drafted", hasDraft: true, holdReason: null, reminderDueAt: null, florida: false, discardReason: null, reminderApproved: false, ...over });
const ids = (c: ReturnType<typeof mapMemberCard>) => c.actions.map((a) => a.id);
const WRITES = ["generate", "approve", "cancel", "cancelReminder", "advanceReminder", "readmit", "regenerate", "remove", "optOut", "reviewDraft", "reviewReminder"];

test("the view is read-only exactly when the viewer is not the owner", () => {
  assert.equal(isReadOnlyView("bd-a", "bd-a"), false);
  assert.equal(isReadOnlyView("bd-a", "bd-b"), true);
});

test("read-only cards: one read action per state, the menu keeps only Abrir ficha, no write action survives", () => {
  const cases: [Partial<CardFacts>, string[], string[]][] = [
    [{ state: "drafted" }, ["viewDraft"], ["openContact"]],
    [{ state: "drafted", hasDraft: false }, [], ["openContact"]],
    [{ state: "approved" }, ["viewEmail"], []],
    [{ state: "sent", reminderDueAt: new Date("2026-10-17T13:00:00Z") }, ["viewSent"], []],
    [{ state: "sent", reminderDueAt: new Date("2026-10-14T13:00:00Z") }, ["viewReminder"], []],
    [{ state: "no_reply" }, ["viewSent"], []],
    [{ state: "replied" }, ["openConversation"], ["openContact"]],
    [{ state: "discarded", discardReason: "no_title" }, [], []],
  ];
  for (const [over, actions, menu] of cases) {
    const c = mapMemberCard(facts(over), NOW, true);
    assert.deepEqual([ids(c), c.menu], [actions, menu], JSON.stringify(over));
  }
  // Both reminder variants, with a due date set: an approved reminder is a card of its own, and its "Cancelar envío"
  // writes, so it must not survive read-only either. Without the second pass this loop never reaches that card.
  for (const state of MEMBER_STATES) {
    for (const reminderApproved of [false, true]) {
      const c = mapMemberCard(facts({ state, reminderDueAt: new Date("2026-10-14T13:00:00Z"), reminderApproved }), NOW, true);
      for (const id of [...ids(c), ...c.menu]) assert.ok(!WRITES.includes(id), `${state} (approved reminder: ${reminderApproved}) offers ${id}`);
    }
  }
});

test("a read-only card keeps its badge, kind and hold reason", () => {
  const own = mapMemberCard(facts({ state: "approved", holdReason: "sync_stale" }), NOW);
  const other = mapMemberCard(facts({ state: "approved", holdReason: "sync_stale" }), NOW, true);
  assert.deepEqual([other.kind, other.tone, other.holdReason], [own.kind, own.tone, own.holdReason]);
});

test("the owner's cards are unchanged when the flag is off", () => {
  assert.deepEqual(ids(mapMemberCard(facts({ state: "drafted" }), NOW, false)), ["reviewDraft", "approve"]);
});

test("viewReminder opens step 2, the other read actions step 1; only read actions pass the guard", () => {
  assert.equal(cardStep("viewReminder"), 2);
  assert.equal(cardStep("viewDraft"), 1);
  for (const id of ["viewDraft", "viewEmail", "viewSent", "viewReminder", "openConversation", "openContact"]) assert.equal(isReadOnlyAction(id), true, id);
  for (const id of [...WRITES, "editSequence", "approveReady", "changeCadence", "createNext"]) assert.equal(isReadOnlyAction(id), false, id);
});

const draft = (over: Partial<DetailDraft> = {}): DetailDraft => ({ subject: "S", body: "B", language: null, edited: false, generatedAt: new Date("2026-10-10T09:00:00Z"), editedAt: null, reviewedAt: null, approvedAt: null, scheduledFor: null, ...over });
const member = (over: Partial<DetailMember> = {}): DetailMember => ({
  memberId: "m1", personId: "00000000-0000-4000-8000-000000000001", state: "drafted", holdReason: null, firstName: "Test1", lastName: "Person",
  jobTitle: "Lead", company: "Acme 1", companyKey: "acme-1", email: "p1@example.test", emailVerified: true, openIt: 2, florida: false,
  leadership: false, lastContactAt: null, repliedAt: null, sentAt: null, reminderDueAt: null, discardedAt: null, discardReason: null, discardedByBdId: null, draft: draft(), reminderDraft: null, ...over,
});

test("the review dialog is read-only for a foreign Sequence: no footer action, never marks the draft reviewed", () => {
  const own = reviewView(member(), 1, DEFAULT_SCHEDULE, NOW)!;
  assert.deepEqual([own.readOnly, own.footer.length > 0, own.marksReviewed], [false, true, true]);
  for (const m of [member(), member({ state: "approved", draft: draft({ approvedAt: NOW }) })]) {
    const v = reviewView(m, 1, DEFAULT_SCHEDULE, NOW, true)!;
    assert.deepEqual([v.readOnly, v.footer, v.marksReviewed], [true, [], false]);
    assert.equal(v.draft.subject, "S", "the text is still readable");
  }
});

test("the read-only strings exist in both languages", () => {
  for (const d of [es, en]) {
    const l = d.sequences;
    for (const k of [l.readOnlyTitle, l.readOnlyBody, l.readOnlyBack, l.readOnlyDialogNotice, l.readOnlyIntroLead, l.readOnlyIntroStrong, l.readOnlyIntroTail, l.actions.viewDraft, l.actions.viewReminder]) assert.ok(k.length > 0);
  }
  assert.match(es.sequences.readOnlyTitle, /\{owner\}/);
});

test("a read-only approved reminder keeps exactly viewReminder and drops cancelReminder", () => {
  const c = mapMemberCard(facts({ state: "sent", reminderDueAt: new Date("2026-10-14T13:00:00Z"), reminderApproved: true }), NOW, true);
  assert.deepEqual([c.kind, ids(c), c.menu], ["reminderApproved", ["viewReminder"], []]);
  assert.equal(cardStep("cancelReminder"), 2);
});

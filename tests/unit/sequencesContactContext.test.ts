import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { en } from "@/lib/i18n/dictionaries/en";
import { es } from "@/lib/i18n/dictionaries/es";
import { contactContextView, optOutErrorKey, showOptOutPrompt, type ContactMembership } from "@/lib/sequences/contactContext";
import { SEND } from "./sendContextFixture";

(globalThis as { React?: unknown }).React = React;
/* eslint-disable @typescript-eslint/no-require-imports */
const { SequenceContext } = require("@/app/(app)/sequences/_components/SequenceContext") as typeof import("@/app/(app)/sequences/_components/SequenceContext");
const { OptOutDialog } = require("@/app/(app)/sequences/_components/OptOutDialog") as typeof import("@/app/(app)/sequences/_components/OptOutDialog");
const { MemberCard } = require("@/app/(app)/sequences/_components/MemberCard") as typeof import("@/app/(app)/sequences/_components/MemberCard");
/* eslint-enable @typescript-eslint/no-require-imports */

const NOW = new Date("2026-10-15T14:00:00Z");
const hours = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
// Synthetic data only: the approved mockups hold real prospects and none of them may enter the repo.
const ms = (over: Partial<ContactMembership> = {}): ContactMembership => ({
  memberId: "m1", sequenceName: "Synthetic sequence", state: "drafted", ownedByViewer: true,
  scheduledFor: null, sentAt: null, repliedAt: null, discardedAt: null, discardReason: null, ...over,
});
const view = (rows: ContactMembership[]) => contactContextView(rows);

test("every state gets its own badge, and `discarded` is split on whether anything was sent", () => {
  const kinds = (over: Partial<ContactMembership>) => view([ms(over)]).rows[0].kind;
  assert.equal(kinds({ state: "drafted" }), "drafted");
  assert.equal(kinds({ state: "approved" }), "approved");
  assert.equal(kinds({ state: "sent", sentAt: hours(5) }), "sent");
  assert.equal(kinds({ state: "no_reply", sentAt: hours(50) }), "noReply");
  assert.equal(kinds({ state: "replied", sentAt: hours(50), repliedAt: hours(2) }), "replied");
  assert.equal(kinds({ state: "discarded", discardedAt: hours(3) }), "discardedUnsent");
  assert.equal(kinds({ state: "discarded", discardedAt: hours(3), sentAt: hours(30) }), "discardedSent");
  assert.equal(kinds({ state: "discarded", discardedAt: hours(3), sentAt: hours(30), discardReason: "opt_out" }), "optedOut");
});

test("the control targets one own membership, is hidden once an opt-out exists, and is absent without an own membership", () => {
  assert.equal(view([ms({ memberId: "a", state: "discarded" }), ms({ memberId: "b", state: "sent", sentAt: hours(1) })]).optOutMemberId, "b", "a live membership is preferred");
  assert.equal(view([ms({ memberId: "a", state: "discarded" })]).optOutMemberId, "a", "a discarded one still lets the address be suppressed");
  assert.equal(view([ms({ ownedByViewer: false })]).optOutMemberId, null, "recordOptOutForMember refuses a Sequence the viewer does not own");
  const done = view([ms({ state: "discarded", discardReason: "opt_out" }), ms({ memberId: "z" })]);
  assert.deepEqual([done.optedOut, done.optOutMemberId], [true, null]);
  assert.equal(view([]).rows.length, 0);
});

test("the dialog scope counts only the viewer's own live memberships, via the same state machine as the write", () => {
  const v = view([ms({ memberId: "a", state: "approved" }), ms({ memberId: "b", state: "replied" }), ms({ memberId: "c", state: "discarded" }), ms({ memberId: "d", state: "sent", ownedByViewer: false })]);
  assert.equal(v.ownLiveCount, 2);
});

test("the opt-out prompt is advisory: only a replied card with a detected phrase, never once opted out", () => {
  assert.equal(showOptOutPrompt("replied", "unsubscribe"), true);
  assert.equal(showOptOutPrompt("replied", null), false);
  assert.equal(showOptOutPrompt("sent", "unsubscribe"), false);
  assert.equal(showOptOutPrompt("discarded", "unsubscribe"), false);
});

test("each refusal the action can return has a distinct message key", () => {
  assert.equal(optOutErrorKey("not_found"), "optOutErrorNotFound");
  assert.equal(optOutErrorKey("no_email"), "optOutErrorNoEmail");
});

const render = (rows: ContactMembership[], labels = es.sequences) =>
  renderToStaticMarkup(createElement(SequenceContext, { memberships: rows, now: NOW, labels, onAction: () => {} }));

test("the block renders nothing for a Contact in no Sequence", () => {
  assert.equal(render([]), "");
});

test("an opted-out Contact shows the mockup's line and no control; a live one shows the control", () => {
  const out = render([ms({ state: "discarded", discardedAt: hours(3), discardReason: "opt_out" })]);
  assert.ok(out.includes("Pidió la baja") && out.includes("no vuelve a entrar a ninguna secuencia, de ningún BD") && !out.includes("No contactar"));
  const live = render([ms({ state: "sent", sentAt: hours(5) })]);
  assert.ok(live.includes("No contactar") && live.includes("Enviado"));
});

test("an unsent discard never claims an email went out, and a sent one does not claim who removed it", () => {
  const unsent = render([ms({ state: "discarded", discardedAt: hours(3) })]);
  assert.ok(unsent.includes("nunca se envió") && !unsent.includes("Correo enviado"));
  const sent = render([ms({ state: "discarded", discardedAt: hours(3), sentAt: hours(30) })]);
  assert.ok(sent.includes("Correo enviado hace") && !sent.includes("quitaste"));
});

test("the dialog states the scope BEFORE confirming: every Sequence, every BD, the replied lead, and that it cannot be undone here", () => {
  const html = renderToStaticMarkup(createElement(OptOutDialog, { open: true, email: "p1@example.test", ownLiveCount: 2, labels: es.sequences, onClose: () => {}, onConfirm: () => {} }));
  for (const needle of ["p1@example.test", "todas las secuencias", "todos los BDs", "2 membresías", "Seguimientos", "no se puede deshacer"]) assert.ok(html.includes(needle), needle);
  const failed = renderToStaticMarkup(createElement(OptOutDialog, { open: true, email: null, ownLiveCount: 0, labels: es.sequences, onClose: () => {}, onConfirm: () => {}, error: es.sequences.optOutErrorNoEmail }));
  assert.ok(failed.includes('role="alert"') && failed.includes(es.sequences.optOutErrorNoEmail));
});

test("a replied card shows the prompt only when a phrase was detected, and the prompt does not suppress by itself", () => {
  const m = { memberId: "m1", personId: "00000000-0000-4000-8000-000000000001", state: "replied", holdReason: null, firstName: "Test1", lastName: "Person", jobTitle: "Lead", company: "Acme", companyKey: "acme", email: "p1@example.test", emailVerified: true, openIt: 0, florida: false, leadership: false, lastContactAt: null, repliedAt: hours(2), sentAt: hours(50), reminderDueAt: null, discardedAt: null, discardReason: null, draft: null, reminderDraft: null } as const;
  const card = (phrase: string | null | undefined) => renderToStaticMarkup(createElement(MemberCard, { member: { ...m }, now: NOW, labels: es.sequences, onAction: () => {}, ownView: true, optOutPhrase: phrase, send: SEND }));
  assert.ok(card("unsubscribe").includes("unsubscribe") && card("unsubscribe").includes("No contactar") && card("unsubscribe").includes("no se suprime"));
  assert.ok(!card(null).includes("No contactar") && !card(undefined).includes("No contactar"));
});

test("English mirrors every new Spanish key", () => {
  const keys = (o: object) => Object.keys(o).sort();
  assert.deepEqual(keys(en.sequences), keys(es.sequences));
  assert.deepEqual(keys(en.sequences.contextBadges), keys(es.sequences.contextBadges));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { es } from "@/lib/i18n/dictionaries/es";
import { en } from "@/lib/i18n/dictionaries/en";
import type { DetailMember, SequenceDetail } from "@/lib/sequences/detailQueries";
import { DEFAULT_SCHEDULE } from "@/lib/sequences/schedule";
import { SEND } from "./sendContextFixture";

(globalThis as { React?: unknown }).React = React;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SequenceDetailView } = require("@/app/(app)/sequences/_components/SequenceDetailView") as typeof import("@/app/(app)/sequences/_components/SequenceDetailView");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BulkBar } = require("@/app/(app)/sequences/_components/BulkBar") as typeof import("@/app/(app)/sequences/_components/BulkBar");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { generationLock } = require("@/lib/sequences/generationLock") as typeof import("@/lib/sequences/generationLock");

const L = es.sequences;
const NOW = new Date("2026-10-15T14:00:00Z");
const draft = { subject: "s", body: "b", edited: false, generatedAt: new Date("2026-10-10T09:00:00Z"), editedAt: null, reviewedAt: null, approvedAt: null, scheduledFor: null };

// Synthetic people only.
function member(i: number, over: Partial<DetailMember>): DetailMember {
  return {
    memberId: `m${i}`, personId: `00000000-0000-4000-8000-00000000000${i}`, state: "drafted", holdReason: null,
    firstName: `Test${i}`, lastName: "Person", jobTitle: "Engineering Lead", company: `Acme ${i}`, companyKey: `acme-${i}`,
    email: `p${i}@example.test`, emailVerified: true, openIt: 1, florida: false, leadership: false, lastContactAt: null,
    repliedAt: null, sentAt: null, reminderDueAt: null, discardedAt: null, discardReason: null, draft: null, reminderDraft: null, ...over,
  };
}

// Several generate buttons and several drafts: the invariant must hold for however many cards there are.
const MEMBERS = [member(1, {}), member(2, {}), member(3, {}), member(4, { draft }), member(5, { draft }), member(6, { draft })];
const detail: SequenceDetail = { id: "seq-1", name: "Test sequence", ownerBdId: "bd-1", ownerName: "Owner", fromAddress: "owner@example.test", schedule: DEFAULT_SCHEDULE, dailySendCap: 5, sentToday: 0, members: MEMBERS };

// The bulk slot as the Screen fills it: a render function that is handed the lock and mounts the real BulkBar with it.
// Selecting only reviewed drafts means the bar is otherwise enabled, so a disabled button can only come from the lock.
const SELECTION = [{ id: "m4", reviewed: true }, { id: "m5", reviewed: true }];
const bulkSlot = (lock: import("@/lib/sequences/generationLock").GenerationLock) =>
  createElement(BulkBar, { selection: SELECTION, labels: L, onAction: () => {}, send: SEND, recipients: [], cap: { cap: 5, sentToday: 0 }, now: NOW, lock });

const renderView = (generatingId: string | null) =>
  renderToStaticMarkup(createElement(SequenceDetailView, { detail, labels: L, send: SEND, now: NOW, onAction: () => {}, viewerBdId: "bd-1", lock: generationLock(generatingId, MEMBERS, L.unnamed), bulk: bulkSlot }));

type Btn = { text: string; disabled: boolean; title: string | null };
const buttons = (html: string): Btn[] =>
  [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(([, attrs, inner]) => ({
    text: inner.replace(/<[^>]*>/g, ""),
    disabled: /\sdisabled=""/.test(attrs),
    title: /\stitle="([^"]*)"/.exec(attrs)?.[1] ?? null,
  }));
const named = (html: string, text: string) => buttons(html).filter((b) => b.text === text);
const fullName = (m: DetailMember) => `${m.firstName} ${m.lastName}`;

test("invariant: while ANY member generates, no generate affordance is enabled on any card", () => {
  for (const generating of MEMBERS.map((m) => m.memberId)) {
    const html = renderView(generating);
    const generate = named(html, L.actions.generate).concat(named(html, L.generating));
    // Derived from the roster: every member without a draft shows exactly one generate button, spinner or not.
    assert.equal(generate.length, MEMBERS.filter((m) => m.draft === null).length);
    for (const b of generate) assert.equal(b.disabled, true, `generating ${generating}: a generate button is enabled`);
  }
});

test("with nothing generating every generate button is enabled", () => {
  const generate = named(renderView(null), L.actions.generate);
  assert.equal(generate.length, MEMBERS.filter((m) => m.draft === null).length);
  assert.ok(generate.every((b) => !b.disabled && b.title === null));
});

test("a locked generate button says why and who it is waiting for", () => {
  const html = renderView("m1");
  const other = named(html, L.actions.generate);
  assert.ok(other.length > 0);
  for (const b of other) assert.equal(b.title, L.generateWaitTitle.replace("{name}", fullName(MEMBERS[0])));
});

test("the clicked card keeps its spinner and the 'Generando…' label", () => {
  const html = renderView("m2");
  const own = named(html, L.generating);
  assert.equal(own.length, 1);
  assert.equal(own[0].disabled, true);
  assert.match(html, /<button[^>]*disabled=""[^>]*><span class="spinner" aria-hidden="true"><\/span>Generando…<\/button>/);
});

test("another member's Revisar and Aprobar stay enabled while a different member generates", () => {
  const html = renderView("m1");
  const review = named(html, L.actions.reviewDraft);
  assert.equal(review.length, MEMBERS.filter((m) => m.draft).length);
  assert.ok(review.every((b) => !b.disabled));
  const approve = named(html, L.reviewApproveNow);
  assert.equal(approve.length, review.length);
  assert.ok(approve.every((b) => !b.disabled));
});

test("the member being (re)generated cannot be reviewed or approved at the same time", () => {
  const html = renderView("m4");
  const review = named(html, L.actions.reviewDraft);
  assert.deepEqual(review.map((b) => b.disabled), [true, false, false]);
  assert.deepEqual(named(html, L.reviewApproveNow).map((b) => b.disabled), [true, false, false]);
});

test("the banner is present exactly while a generation is in flight and names the member", () => {
  const idle = renderView(null);
  assert.ok(!idle.includes("spinner-standalone") && !idle.includes(L.generatingBannerTitle.replace("{name}", "")));
  for (const m of MEMBERS) {
    const html = renderView(m.memberId);
    assert.match(html, /<div class="alert alert-info mb-lg" role="status"><span class="spinner-standalone" aria-hidden="true"><\/span>/);
    assert.ok(html.includes(L.generatingBannerTitle.replace("{name}", fullName(m))));
  }
});

test("the header's approve-ready button is locked while generating", () => {
  assert.ok(named(renderView("m1"), L.approveReady.replace("{n}", "3")).every((b) => b.disabled));
});

test("the bulk bar rendered inside the view is locked exactly while a generation is in flight", () => {
  const approve = (html: string) => buttons(html).find((b) => b.text.startsWith("Aprobar y enviar ahora los 2"));
  assert.equal(approve(renderView(null))?.disabled, false);
  for (const m of MEMBERS) {
    const html = renderView(m.memberId);
    assert.equal(approve(html)?.disabled, true, `bulk approve enabled while ${m.memberId} generates`);
    assert.ok(html.includes(L.generateBulkWaitTitle));
  }
});

test("generationLock: every member is locked out of generating exactly when some member generates", () => {
  for (const generating of [null, ...MEMBERS.map((m) => m.memberId)]) {
    const lock = generationLock(generating, MEMBERS, L.unnamed);
    assert.equal(lock.active, generating !== null);
    assert.equal(lock.bulkApproveDisabled, generating !== null);
    for (const m of MEMBERS) {
      const card = lock.card(m.memberId);
      assert.equal(card.generateDisabled, generating !== null, `${m.memberId} while ${generating}`);
      assert.equal(card.regenerateDisabled, generating !== null);
      assert.equal(card.busyHere, generating === m.memberId);
      assert.equal(card.reviewDisabled, generating === m.memberId);
    }
    assert.equal(lock.generatingName, generating === null ? null : fullName(MEMBERS.find((m) => m.memberId === generating)!));
  }
});

test("generationLock: a member without a name falls back to the unnamed label", () => {
  assert.equal(generationLock("x", [{ memberId: "x", firstName: null, lastName: null }], "Sin nombre").generatingName, "Sin nombre");
});

test("the new strings exist in both dictionaries with the same placeholders", () => {
  for (const key of ["generatingBannerTitle", "generatingBannerBody", "generatingBannerFail", "generateWaitTitle", "generateBulkWaitTitle"] as const) {
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    assert.ok(es.sequences[key].length > 0 && en.sequences[key].length > 0);
    assert.equal(placeholders(es.sequences[key]), placeholders(en.sequences[key]), key);
  }
});

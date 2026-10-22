import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { en } from "@/lib/i18n/dictionaries/en";
import { es } from "@/lib/i18n/dictionaries/es";
import type { DetailDraft, DetailMember, SequenceDetail } from "@/lib/sequences/detailQueries";
import { DEFAULT_SCHEDULE } from "@/lib/sequences/schedule";
import { IDLE_LOCK, SEND } from "./sendContextFixture";

(globalThis as { React?: unknown }).React = React;
/* eslint-disable @typescript-eslint/no-require-imports */
const { ReviewDialog } = require("@/app/(app)/sequences/_components/ReviewDialog") as typeof import("@/app/(app)/sequences/_components/ReviewDialog");
const { SequenceDetailView } = require("@/app/(app)/sequences/_components/SequenceDetailView") as typeof import("@/app/(app)/sequences/_components/SequenceDetailView");
const { EditSequenceDialog } = require("@/app/(app)/sequences/_components/EditSequenceDialog") as typeof import("@/app/(app)/sequences/_components/EditSequenceDialog");
/* eslint-enable @typescript-eslint/no-require-imports */

const NOW = new Date("2026-10-15T14:00:00Z");
const draft = (over: Partial<DetailDraft> = {}): DetailDraft => ({ subject: "Subject", body: "Body", edited: false, editedAt: null, reviewedAt: null, approvedAt: null, scheduledFor: null, ...over });
const member = (id: string, over: Partial<DetailMember> = {}): DetailMember => ({
  memberId: id, personId: `00000000-0000-4000-8000-00000000000${id}`, state: "drafted", holdReason: null, firstName: `Test${id}`, lastName: "Person", jobTitle: "Lead",
  company: "Acme", companyKey: "acme", email: `p${id}@example.test`, emailVerified: true, openIt: 1, florida: false, leadership: false, lastContactAt: null,
  repliedAt: null, sentAt: null, reminderDueAt: null, discardedAt: null, discardReason: null, draft: draft(), reminderDraft: null, ...over,
});
const detail = (members: DetailMember[]): SequenceDetail => ({ id: "s1", name: "Synthetic", ownerBdId: "bd1", ownerName: "Owner", fromAddress: "from@example.test", schedule: DEFAULT_SCHEDULE, dailySendCap: 5, sentToday: 0, members });

// --- the review dialog never claims "no signals" when the signals simply are not known ---------------------------

const dialog = (signals: string[] | null) =>
  renderToStaticMarkup(createElement(ReviewDialog, { open: true, onClose: () => {}, member: member("1"), step: 1, fromAddress: "from@example.test", schedule: DEFAULT_SCHEDULE, signals, now: NOW, labels: es.sequences, ownView: true, onAction: () => {}, send: SEND }));

test("known signals render as chips, an empty list says none, and an unknown list renders no claim at all", () => {
  assert.match(dialog(["1 vacante IT abierta"]), /1 vacante IT abierta/);
  assert.match(dialog([]), new RegExp(es.sequences.reviewSignalsNone));
  const unknown = dialog(null);
  assert.doesNotMatch(unknown, new RegExp(es.sequences.reviewSignalsNone));
  assert.doesNotMatch(unknown, new RegExp(es.sequences.reviewSignals));
});

// --- bulk selection on the detail screen -------------------------------------------------------------------------

const view = (members: DetailMember[], selected?: Set<string>) =>
  renderToStaticMarkup(createElement(SequenceDetailView, { detail: detail(members), labels: es.sequences, now: NOW, onAction: () => {}, viewerBdId: "bd1", send: SEND, lock: IDLE_LOCK, selected, onToggle: selected ? () => {} : undefined, bulk: () => createElement("div", { id: "bulk-slot" }) }));

test("only draft cards get a selection checkbox, and the bulk slot sits between the heading and the cards", () => {
  const html = view([member("1"), member("2", { state: "approved", draft: draft({ approvedAt: NOW, scheduledFor: NOW }) }), member("3", { state: "sent", sentAt: NOW })], new Set(["1"]));
  assert.equal(html.match(/type="checkbox"/g)?.length, 1);
  const box = html.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0] ?? "";
  assert.match(box, /checked=""/);
  assert.match(box, /aria-label="Elegir a Test1 Person"/);
  assert.ok(html.indexOf(es.sequences.membersTitle) < html.indexOf('id="bulk-slot"'));
  assert.ok(html.indexOf('id="bulk-slot"') < html.indexOf("Test1 Person"));
});

test("without a selection the screen is exactly what it was: no checkboxes", () => {
  assert.doesNotMatch(view([member("1")]), /type="checkbox"/);
});

// --- the edit dialog ---------------------------------------------------------------------------------------------

test("the edit dialog carries the sequence's current name and cap, labelled, with the create form's copy", () => {
  const html = renderToStaticMarkup(createElement(EditSequenceDialog, { open: true, name: "Mi secuencia", cap: 7, labels: es.sequences, onClose: () => {}, onSave: () => {} }));
  assert.match(html, new RegExp(es.sequences.editTitle));
  assert.match(html, /value="Mi secuencia"/);
  assert.match(html, /value="7"/);
  assert.match(html, new RegExp(`>${es.sequences.newName}<`));
  assert.match(html, new RegExp(`>${es.sequences.newCap}<`));
});

// --- copy -------------------------------------------------------------------------------------------------------

test("the new container strings exist in both languages with the same shape, and 'Campaña' appears nowhere", () => {
  const strings = (o: unknown): string[] => (typeof o === "string" ? [o] : o && typeof o === "object" ? Object.values(o).flatMap(strings) : []);
  assert.deepEqual(Object.keys(es.sequences.reviewErrors).sort(), Object.keys(en.sequences.reviewErrors).sort());
  assert.deepEqual(Object.keys(es.sequences.reinstateErrors).sort(), Object.keys(en.sequences.reinstateErrors).sort());
  for (const dict of [es.sequences, en.sequences]) for (const text of strings(dict)) assert.doesNotMatch(text, /campa(ñ|n)a|campaign/i, text);
  assert.equal(es.nav.sequences, "Secuencias");
});

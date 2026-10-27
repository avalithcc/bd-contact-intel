/** The wrong-language draft on the card and in the review dialog (mockup borrador-otro-idioma.html): the alert, the badge, and the controls that wait. */
import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { en } from "@/lib/i18n/dictionaries/en";
import { es } from "@/lib/i18n/dictionaries/es";
import { buildMemberAudience } from "@/lib/sequences/audienceView";
import type { AudienceLanguage } from "@/lib/sequences/complianceAudience";
import type { DetailDraft, DetailMember } from "@/lib/sequences/detailQueries";
import { DEFAULT_SCHEDULE } from "@/lib/sequences/schedule";
import { IDLE_LOCK, SEND } from "./sendContextFixture";

(globalThis as { React?: unknown }).React = React;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MemberCard } = require("@/app/(app)/sequences/_components/MemberCard") as typeof import("@/app/(app)/sequences/_components/MemberCard");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ReviewDialog } = require("@/app/(app)/sequences/_components/ReviewDialog") as typeof import("@/app/(app)/sequences/_components/ReviewDialog");

const NOW = new Date("2026-10-27T15:00:00Z");
const draft = (language: AudienceLanguage | null, over: Partial<DetailDraft> = {}): DetailDraft => ({ subject: "S", body: "B", language, edited: false, generatedAt: new Date("2026-10-20T09:00:00Z"), editedAt: null, reviewedAt: new Date("2026-10-21T09:00:00Z"), approvedAt: null, scheduledFor: null, ...over });
// A synthetic person; the audience comes from the real producer. Argentina resolves to Spanish.
const member = (language: AudienceLanguage | null, over: Partial<DetailMember> = {}): DetailMember => ({
  memberId: "m1", personId: "00000000-0000-4000-8000-000000000001", state: "drafted", holdReason: null, firstName: "Test1", lastName: "Person", jobTitle: "Lead", company: "Acme", companyKey: "acme",
  email: "p1@example.test", emailVerified: true, openIt: 0, florida: false, leadership: false, lastContactAt: null, repliedAt: null, sentAt: null, reminderDueAt: null, discardedAt: null, discardReason: null, discardedByBdId: null,
  draft: draft(language), reminderDraft: null, languageChoice: null, preferredLanguage: null,
  audience: buildMemberAudience({ mobilePhone: null, phone: null, personCountry: "Argentina", companyCountry: null, postingMarkets: [], rosterCountries: [] }), ...over,
});
const card = (m: DetailMember, over: { selected?: boolean; readOnly?: boolean; ownView?: boolean } = {}) =>
  renderToStaticMarkup(createElement(MemberCard, { member: m, now: NOW, labels: es.sequences, onAction: () => {}, ownView: over.ownView ?? true, readOnly: over.readOnly, selection: { selected: over.selected ?? false, onToggle: () => {} }, generation: IDLE_LOCK, send: SEND }));
const dialog = (m: DetailMember, labels = es.sequences) =>
  renderToStaticMarkup(createElement(ReviewDialog, { open: true, onClose: () => {}, member: m, step: 1, fromAddress: "from@example.test", schedule: DEFAULT_SCHEDULE, signals: [], now: NOW, labels, ownView: true, onAction: () => {}, send: SEND }));

const checkbox = (html: string) => /<input[^>]*type="checkbox"[^>]*>/.exec(html)?.[0] ?? "";
const NOTHING = ["Otro idioma", "ahora le escribiríamos", "Mantener en", "no se puede aprobar así"];

test("a Spanish-bound draft written in English shows the badge, the alert with both exits, and a selection that cannot be made", () => {
  const html = card(member("en"));
  assert.ok(html.includes('<span class="badge badge-warn" title="El borrador está en inglés; hoy le escribiríamos en español">Otro idioma</span>'), html);
  assert.ok(html.includes("<strong>El borrador está en inglés, pero ahora le escribiríamos en español</strong>"), html);
  assert.ok(html.includes("El correo no se puede aprobar así."));
  assert.ok(html.includes("Regenerar en español") && html.includes("Mantener en inglés"));
  assert.ok(!html.includes("Aprobar igual"), "the owner decided there is no override button");
  assert.match(checkbox(html), /disabled=""/);
  assert.match(checkbox(html), /title="Está en inglés y hoy le escribiríamos en español/);
  assert.match(html, /title="El borrador está en inglés\. Regeneralo en español o mantenelo en inglés antes de aprobar\."/);
  assert.match(html, /<button[^>]*class="btn btn-primary btn-sm"[^>]*disabled=""/, "the approve control waits");
});

test("a matching draft, an unknown one and one kept by a person render the card as always", () => {
  for (const m of [member("es"), member(null), member("en", { languageChoice: { language: "en", byName: "Ana", at: null } })]) {
    const html = card(m);
    for (const needle of NOTHING) assert.ok(!html.includes(needle), needle);
    assert.doesNotMatch(checkbox(html), /disabled/);
  }
});

test("a draft already selected when it turned mismatched keeps an enabled checkbox, so it can be taken out of the selection", () => {
  assert.doesNotMatch(checkbox(card(member("en"), { selected: true })), /disabled/);
});

test("an admin reading another BD's sequence sees why, with no button to change it", () => {
  const html = card(member("en"), { readOnly: true, ownView: false });
  assert.ok(html.includes("El correo no se puede aprobar así.") && !html.includes("Mantener en") && !html.includes("Regenerar en español"));
});

test("a hand-edited draft in the wrong language warns that regenerating loses the text and points at Mantener", () => {
  const html = card(member("en", { draft: draft("en", { edited: true, editedAt: new Date("2026-10-22T09:00:00Z") }) }));
  assert.ok(html.includes("Lo editaste a mano: regenerarlo reemplaza tu texto y no se puede recuperar. Si el texto está bien, mantenelo en inglés."), html);
});

test("an approved draft shows no exits: the release re-check holds it and the hold is worded", () => {
  const html = card(member("en", { state: "approved", draft: draft("en", { approvedAt: NOW, scheduledFor: NOW }) }));
  for (const needle of NOTHING) assert.ok(!html.includes(needle), needle);
});

test("the review dialog carries the alert, the two exits, the footer help and a disabled approve", () => {
  const html = dialog(member("en"));
  assert.ok(html.includes("El borrador está en inglés, pero ahora le escribiríamos en español") && html.includes("Regenerar en español") && html.includes("Mantener en inglés"), html);
  assert.ok(html.includes("Regenerar abre el diálogo de idioma, con español elegido, y reemplaza este texto."));
  assert.ok(html.includes("Aprobar se habilita cuando el idioma del borrador coincide con el que usaríamos hoy."));
  assert.match(html, /<button[^>]*class="btn btn-primary"[^>]*disabled=""[^>]*>(?:<svg.*?<\/svg>)?Aprobar y enviar ahora/);
});

test("the review dialog of a matching draft is the dialog of always", () => {
  const html = dialog(member("es"));
  for (const needle of [...NOTHING, "Aprobar se habilita"]) assert.ok(!html.includes(needle), needle);
  assert.doesNotMatch(html, /<button[^>]*class="btn btn-primary"[^>]*disabled=""[^>]*>(?:<svg.*?<\/svg>)?Aprobar y enviar ahora/);
});

test("the English dictionary words the card alert, and both dictionaries word the refusal and the hold", () => {
  const html = renderToStaticMarkup(createElement(MemberCard, { member: member("en"), now: NOW, labels: en.sequences, onAction: () => {}, ownView: true, generation: IDLE_LOCK, send: SEND }));
  assert.ok(html.includes("Other language") && html.includes("Regenerate in Spanish") && html.includes("Keep in English"), html);
  for (const dict of [en, es]) {
    assert.ok(dict.sequences.reviewErrors.wrong_language.length > 0 && dict.sequences.holdReasons.wrong_language.length > 0);
  }
});

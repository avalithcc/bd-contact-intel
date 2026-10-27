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

test("the review dialog carries the mockup's lead and body, the badge by the body label, the exits and a disabled approve", () => {
  const html = dialog(member("en"));
  assert.ok(html.includes("<strong>Este borrador está en inglés.</strong> Ahora le escribiríamos en español ("), html);
  assert.ok(html.includes("Si lo aprobás así, el correo sale en inglés, por eso no se puede aprobar todavía."));
  assert.match(html, /Cuerpo<span[^>]*> <span class="badge badge-warn">en inglés<\/span>|Cuerpo <span class="badge badge-warn">en inglés<\/span>/);
  assert.ok(html.includes("Regenerar en español") && html.includes("Mantener en inglés"));
  assert.ok(html.includes("Regenerar abre el diálogo de idioma, con español elegido, y reemplaza este texto."));
  assert.match(html, /<button[^>]*class="btn btn-primary"[^>]*disabled=""[^>]*>(?:<svg.*?<\/svg>)?Aprobar y enviar ahora/);
});

test("the help line is inside the footer, so it stays with the disabled approve, and the approve points at it", () => {
  const html = dialog(member("en"));
  const footer = html.slice(html.indexOf('class="dialog-footer"'));
  const help = /<p class="help" id="([^"]+)">Aprobar se habilita cuando el idioma del borrador coincide con el que usaríamos hoy\.<\/p>/.exec(footer);
  assert.ok(help, "the help line is in the footer");
  assert.ok(footer.includes(`aria-describedby="${help[1]}"`), "the disabled approve is described by it");
  assert.equal(html.split("Aprobar se habilita").length - 1, 1, "and only there");
});

test("role=alert is only for the dialog: the card's alert is a note", () => {
  const cardAlert = card(member("en")).split("alert-warn")[1] ?? "";
  assert.ok(cardAlert.includes('role="note"') && !cardAlert.slice(0, 80).includes('role="alert"'), cardAlert.slice(0, 120));
  assert.match(dialog(member("en")), /class="alert alert-warn" role="alert"/);
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

// --- the header button: the number it shows is the number the click selects ----------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SequenceDetailView } = require("@/app/(app)/sequences/_components/SequenceDetailView") as typeof import("@/app/(app)/sequences/_components/SequenceDetailView");
const detailOf = (members: DetailMember[]) => ({ id: "s1", name: "Seq", ownerBdId: "bd1", ownerName: "Owner", fromAddress: "from@example.test", schedule: DEFAULT_SCHEDULE, dailySendCap: 5, sentToday: 0, members });
const header = (members: DetailMember[]) => {
  const html = renderToStaticMarkup(createElement(SequenceDetailView, { detail: detailOf(members), labels: es.sequences, now: NOW, onAction: () => {}, viewerBdId: "bd1", lock: IDLE_LOCK, send: SEND }));
  return /<button[^>]*>(Aprobar (?:los \d+ listos|el listo))<\/button>/.exec(html)?.[0] ?? "";
};
const withId = (id: string, m: DetailMember): DetailMember => ({ ...m, memberId: id, personId: `00000000-0000-4000-8000-00000000000${id}` });

test("the header button counts only the drafts the click will select: 5 drafts, 2 in another language, says 3", () => {
  const html = header([withId("1", member("es")), withId("2", member("es")), withId("3", member(null)), withId("4", member("en")), withId("5", member("en"))]);
  assert.match(html, />Aprobar los 3 listos</);
  assert.doesNotMatch(html, /disabled/);
});

test("when every draft is in another language the header button is disabled instead of doing nothing", () => {
  const html = header([withId("1", member("en")), withId("2", member("en"))]);
  assert.match(html, /disabled=""[^>]*>Aprobar los 0 listos</);
});

test("the hold line is shown on an approved card and never on an unapproved draft, where a stale hold would contradict the card", () => {
  const prefix = `${es.sequences.holdPrefix} ${es.sequences.holdReasons.wrong_language}`;
  const approved = card(member("en", { state: "approved", holdReason: "wrong_language", draft: draft("en", { approvedAt: NOW, scheduledFor: NOW }) }));
  assert.ok(approved.includes(prefix), approved);
  const drafted = card(member("es", { holdReason: "wrong_language" }));
  assert.ok(!drafted.includes(es.sequences.holdPrefix), drafted);
});

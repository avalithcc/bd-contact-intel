import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { en } from "@/lib/i18n/dictionaries/en";
import { es } from "@/lib/i18n/dictionaries/es";
import type { DetailDraft, DetailMember } from "@/lib/sequences/detailQueries";
import { reviewView } from "@/lib/sequences/reviewDialog";
import { DEFAULT_SCHEDULE } from "@/lib/sequences/schedule";

(globalThis as { React?: unknown }).React = React;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ReviewDialog } = require("@/app/(app)/sequences/_components/ReviewDialog") as typeof import("@/app/(app)/sequences/_components/ReviewDialog");

const NOW = new Date("2026-10-15T14:00:00Z");
const hours = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const draft = (over: Partial<DetailDraft> = {}): DetailDraft => ({ subject: "Subject 1", body: "Body 1\n\n--\nSynthetic footer", edited: false, reviewedAt: null, approvedAt: null, scheduledFor: null, ...over });
// Synthetic person only: the approved mockup holds real prospects and none of them may enter the repo.
const member = (over: Partial<DetailMember> = {}): DetailMember => ({
  memberId: "m1", personId: "00000000-0000-4000-8000-000000000001", state: "drafted", holdReason: null, firstName: "Test1", lastName: "Person",
  jobTitle: "Engineering Lead", company: "Acme 1", companyKey: "acme-1", email: "p1@example.test", emailVerified: true, openIt: 2, florida: false,
  leadership: false, lastContactAt: null, repliedAt: null, sentAt: null, reminderDueAt: null, discardedAt: null, discardReason: null, draft: draft(), reminderDraft: null, ...over,
});
const view = (m: DetailMember, step: 1 | 2 = 1) => reviewView(m, step, DEFAULT_SCHEDULE, NOW);

test("a drafted member is editable with all three footer actions, and an unopened draft asks to be marked reviewed", () => {
  const v = view(member())!;
  assert.deepEqual([v.kind, v.readOnly, v.footer, v.marksReviewed], ["draft", false, ["regenerate", "save", "approve"], true]);
  assert.equal(view(member({ draft: draft({ reviewedAt: hours(1) }) }))!.marksReviewed, false, "reopening never rewrites the flag");
});

test("sent, replied and no_reply are read-only with no footer action and never mark reviewed", () => {
  for (const state of ["sent", "replied", "no_reply"] as const) {
    const v = view(member({ state, sentAt: hours(96) }))!;
    assert.deepEqual([v.kind, v.readOnly, v.footer, v.marksReviewed], ["sent", true, [], false], state);
  }
});

test("an approved draft is editable but cannot be approved again", () => {
  const v = view(member({ state: "approved", draft: draft({ approvedAt: hours(2), scheduledFor: new Date("2026-10-16T13:00:00Z") }) }))!;
  assert.deepEqual([v.kind, v.readOnly, v.footer, v.cadence?.step1.kind], ["approved", false, ["regenerate", "save"], "scheduled"]);
});

test("the reminder reads the step 2 draft and is a separate variant", () => {
  const sent = member({ state: "sent", sentAt: hours(170), reminderDraft: draft({ subject: "Reminder 1" }) });
  const v = view(sent, 2)!;
  assert.deepEqual([v.kind, v.draft.subject, v.footer, v.cadence?.step1.kind], ["reminder", "Reminder 1", ["regenerate", "save", "approve"], "sent"]);
  assert.equal(view(member({ state: "sent", sentAt: hours(170) }), 2), null, "no reminder draft, nothing to open");
});

const render = (m: DetailMember, step: 1 | 2 = 1, ownView = true, labels = es.sequences) =>
  renderToStaticMarkup(createElement(ReviewDialog, { open: true, onClose: () => {}, member: m, step, fromAddress: "from@example.test", schedule: DEFAULT_SCHEDULE, signals: ["1 vacante IT abierta"], now: NOW, labels, ownView, onAction: () => {} }));

test("the draft dialog carries every mockup element in order", () => {
  const html = render(member());
  const order = ["Test1 Person · Engineering Lead en Acme 1", "Leelo antes de aprobar", "Señales usadas", "1 vacante IT abierta", ">Para<", "p1@example.test", "Desde", "from@example.test", ">Asunto<", "Subject 1", ">Cuerpo<", "Synthetic footer", "Editalo libremente", "Cadencia para este contacto", "Paso 1", "Si lo aprobás ahora, sale el", "Paso 2", "Recordatorio el", "Regenerar", "Guardar sin aprobar", "Aprobar y programar"];
  let at = -1;
  for (const needle of order) { const i = html.indexOf(needle, at + 1); assert.ok(i > at, `${needle} missing or out of order`); at = i; }
  assert.match(html, /id="[^"]*-to"[^>]*readOnly=""|readOnly=""[^>]*id="[^"]*-to"/);
});

test("a member stopped before any send is `stopped`, not `sent`: no false 'already went out' and no cadence", () => {
  // Discarded from `drafted` or `approved` is the common case: the roster drops people before step 1 releases.
  const never = member({ state: "discarded", discardedAt: hours(24), discardReason: "no title", sentAt: null });
  const v = view(never)!;
  assert.deepEqual([v.kind, v.readOnly, v.footer, v.cadence], ["stopped", true, [], null]);
  const html = render(never);
  assert.ok(html.includes(es.sequences.reviewStoppedNotice), "it says the mail never went out");
  assert.ok(!html.includes(es.sequences.reviewSentNotice), "it must never claim the mail already went out");
  assert.ok(!html.includes(es.sequences.reviewCadence), "there is no send to describe, so no cadence is projected");
  // Discarded AFTER the send really is the sent variant: the mail is out there.
  assert.equal(view(member({ state: "discarded", discardedAt: hours(2), sentAt: hours(96) }))!.kind, "sent");
});

test("an approved draft warns that saving cancels the scheduled send", () => {
  const approved = member({ state: "approved", draft: draft({ approvedAt: hours(2), scheduledFor: new Date("2026-10-16T13:00:00Z") }) });
  // saveDraftEdit() clears approved_at and scheduled_for and moves the member back to `drafted` (draftQueries.ts:188).
  // That is right — an approval binds to the exact content — but the BD has to see the cancellation coming.
  assert.ok(render(approved).includes(es.sequences.reviewApprovedEditWarning), "the approved variant warns before it withdraws the approval");
  assert.ok(!render(member()).includes(es.sequences.reviewApprovedEditWarning), "an unapproved draft has no scheduled send to cancel");
});

test("the read-only dialog offers only Cerrar and no edit-protection help", () => {
  const html = render(member({ state: "replied", sentAt: hours(96), repliedAt: hours(6) }));
  assert.ok(html.includes("ya salió") && html.includes("Cerrar"));
  for (const gone of ["Regenerar", "Guardar sin aprobar", "Aprobar y programar", "Editalo libremente", "Señales usadas"]) assert.ok(!html.includes(gone), gone);
});

test("the reminder dialog states the intro date and that no reply has been seen since", () => {
  const html = render(member({ state: "sent", sentAt: new Date("2026-10-08T13:00:00Z"), reminderDraft: draft() }), 2);
  assert.ok(html.includes("Correo de presentación enviado el 08/10") && html.includes("no vimos ninguna respuesta"));
  assert.ok(!en.sequences.reviewReminderNotice.includes("{ago}"));
});

test("attribution: the dialog never credits the reader with an approval or an email under their name unless they own the Sequence", () => {
  const approved = member({ state: "approved", draft: draft({ approvedAt: hours(2), scheduledFor: new Date("2026-10-16T13:00:00Z") }) });
  const html = render(approved, 1, false);
  assert.ok(html.includes("Aprobado hace 2 h") && !html.includes("por vos") && !html.includes("tu nombre"));
  const unapproved = render(member(), 1, false);
  assert.ok(!unapproved.includes("bajo tu nombre") && unapproved.includes("desde la cuenta remitente"));
  assert.ok(render(member(), 1, true).includes("bajo tu nombre"));
});

test("every new review and bulk key exists in both languages", () => {
  const keys = (o: Record<string, unknown>) => Object.keys(o).filter((k) => /^(review|bulk)/.test(k)).sort();
  assert.deepEqual(keys(en.sequences), keys(es.sequences));
  assert.ok(keys(es.sequences).length > 40);
});

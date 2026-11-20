import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { en } from "@/lib/i18n/dictionaries/en";
import { es } from "@/lib/i18n/dictionaries/es";
import type { DetailDraft, DetailMember } from "@/lib/sequences/detailQueries";
import { reviewView } from "@/lib/sequences/reviewDialog";
import { DEFAULT_SCHEDULE } from "@/lib/sequences/schedule";
import { SEND } from "./sendContextFixture";

(globalThis as { React?: unknown }).React = React;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ReviewDialog } = require("@/app/(app)/sequences/_components/ReviewDialog") as typeof import("@/app/(app)/sequences/_components/ReviewDialog");

const NOW = new Date("2026-10-15T14:00:00Z");
const hours = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const draft = (over: Partial<DetailDraft> = {}): DetailDraft => ({ subject: "Subject 1", body: "Body 1\n\n--\nSynthetic footer", language: null, edited: false, generatedAt: new Date("2026-10-10T09:00:00Z"), editedAt: null, reviewedAt: null, approvedAt: null, scheduledFor: null, ...over });
// Synthetic person only: the approved mockup holds real prospects and none of them may enter the repo.
const member = (over: Partial<DetailMember> = {}): DetailMember => ({
  memberId: "m1", personId: "00000000-0000-4000-8000-000000000001", state: "drafted", holdReason: null, firstName: "Test1", lastName: "Person",
  jobTitle: "Engineering Lead", company: "Acme 1", companyKey: "acme-1", email: "p1@example.test", emailVerified: true, openIt: 2, florida: false,
  leadership: false, lastContactAt: null, repliedAt: null, sentAt: null, reminderDueAt: null, discardedAt: null, discardReason: null, discardedByBdId: null, draft: draft(), reminderDraft: null, ...over,
});
const view = (m: DetailMember, step: 1 | 2 = 1) => reviewView(m, step, DEFAULT_SCHEDULE, NOW);

test("a drafted member is editable with every footer action, and an unopened draft asks to be marked reviewed", () => {
  const v = view(member())!;
  assert.deepEqual([v.kind, v.readOnly, v.footer, v.marksReviewed], ["draft", false, ["regenerate", "regenerateSubject", "save", "reviewed", "approve"], true]);
  assert.equal(view(member({ draft: draft({ reviewedAt: hours(1) }) }))!.marksReviewed, false, "reopening never rewrites the flag");
});

/**
 * The dialog is where a BD reads the subject and decides it is weak, so it is where "regenerate only the subject"
 * belongs. It first shipped in the card's "..." menu alone and the owner went looking for it here.
 */
test("the subject-only regenerate is offered on step 1 and never on a reminder", () => {
  assert.ok(view(member())!.footer.includes("regenerateSubject"), "step 1 offers it");
  const reminder = view(member({ state: "sent", sentAt: hours(96), reminderDraft: draft() }), 2);
  assert.ok(reminder === null || !reminder.footer.includes("regenerateSubject"), "a reminder's subject belongs to the thread");
});

test("\"Revisado\" is in the footer between save and approve only while the draft is unmarked and editable", () => {
  const f = view(member())!.footer;
  assert.ok(f.indexOf("save") < f.indexOf("reviewed") && f.indexOf("reviewed") < f.indexOf("approve"));
  assert.equal(f.filter((id) => id === "regenerate" || id === "regenerateSubject").length, 2, "the left group is unchanged");
  assert.ok(!view(member({ draft: draft({ reviewedAt: hours(1) }) }))!.footer.includes("reviewed"), "already marked: not offered again");
  assert.ok(!reviewView(member(), 1, DEFAULT_SCHEDULE, NOW, true)!.footer.includes("reviewed"), "a foreign Sequence is read-only");
  assert.ok(!view(member({ state: "approved", draft: draft({ approvedAt: hours(1) }) }))!.footer.includes("reviewed"), "an approved draft is not a review");
});

test("sent, replied and no_reply are read-only with no footer action and never mark reviewed", () => {
  for (const state of ["sent", "replied", "no_reply"] as const) {
    const v = view(member({ state, sentAt: hours(96) }))!;
    assert.deepEqual([v.kind, v.readOnly, v.footer, v.marksReviewed], ["sent", true, [], false], state);
  }
});

test("an approved draft is editable but cannot be approved again", () => {
  const v = view(member({ state: "approved", draft: draft({ approvedAt: hours(2), scheduledFor: new Date("2026-10-16T13:00:00Z") }) }))!;
  assert.deepEqual([v.kind, v.readOnly, v.footer, v.cadence?.step1.kind], ["approved", false, ["regenerate", "regenerateSubject", "save"], "scheduled"]);
});

test("the reminder reads the step 2 draft and is a separate variant", () => {
  const sent = member({ state: "sent", sentAt: hours(170), reminderDraft: draft({ subject: "Reminder 1" }) });
  const v = view(sent, 2)!;
  assert.deepEqual([v.kind, v.draft.subject, v.footer, v.cadence?.step1.kind], ["reminder", "Reminder 1", ["regenerate", "save", "reviewed", "approve"], "sent"]);
  assert.equal(view(member({ state: "sent", sentAt: hours(170) }), 2), null, "no reminder draft, nothing to open");
});

const render = (m: DetailMember, step: 1 | 2 = 1, ownView = true, labels = es.sequences) =>
  renderToStaticMarkup(createElement(ReviewDialog, { open: true, onClose: () => {}, member: m, step, fromAddress: "from@example.test", schedule: DEFAULT_SCHEDULE, signals: ["1 vacante IT abierta"], now: NOW, labels, ownView, onAction: () => {}, send: SEND }));

test("the draft dialog carries every mockup element in order", () => {
  const html = render(member());
  const order = ["Test1 Person · Engineering Lead en Acme 1", "Leelo antes de aprobar", "Señales usadas", "1 vacante IT abierta", ">Para<", "p1@example.test", "Desde", "from@example.test", ">Asunto<", "Subject 1", ">Cuerpo<", "Synthetic footer", "Editalo libremente", "Cadencia para este contacto", "Paso 1", "Hoy sale:", "Paso 2", "Recordatorio el", "Regenerar", "Guardar sin aprobar", "Aprobar y enviar ahora"];
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

test("a hand-edited draft reports that it is edited and when; a never-edited one does not", () => {
  const editedAt = hours(2);
  const mine = view(member({ draft: draft({ edited: true, editedAt }) }))!;
  assert.deepEqual([mine.edited, mine.editedAt], [true, editedAt]);
  const auto = view(member())!;
  assert.deepEqual([auto.edited, auto.editedAt], [false, null]);
  assert.deepEqual(Object.keys(mine).includes("confirmRegenerate"), false, "whether Regenerar needs a confirmation is the server's call, not the view model's");
});

function banner(m: DetailMember, ownView: boolean, lang = es) {
  return renderToStaticMarkup(createElement(ReviewDialog, { open: true, onClose: () => {}, member: m, step: 1, fromAddress: "from@example.test", schedule: DEFAULT_SCHEDULE, signals: ["s1"], now: NOW, labels: lang.sequences, ownView, onAction: () => {}, send: SEND }));
}

const strongMine = `<strong>${es.sequences.reviewEditedStrong}</strong>`; // the body help also says "tu versión", so match the notice markup
const strongOther = `<strong>${es.sequences.reviewEditedStrongOther}</strong>`;
test("the notice says whose text it is only when the draft was edited, and the irreversibility clause survives in both variants", () => {
  const auto = banner(member(), true);
  assert.ok(auto.includes(es.sequences.reviewNotice) && !auto.includes(strongMine));
  const mine = banner(member({ draft: draft({ edited: true, editedAt: hours(2) }) }), true);
  assert.ok(mine.includes(strongMine) && mine.includes("hace 2 h") && !mine.includes(es.sequences.reviewNotice));
  assert.ok(mine.includes(es.sequences.reviewEditedTail) && auto.includes(es.sequences.reviewNoticeTail));
  assert.ok(mine.includes(`<strong>${es.sequences.reviewSignalsEditedStrong}</strong>`) && mine.includes(es.sequences.reviewSignalsEditedTail) && !mine.includes(es.sequences.reviewSignalsHelp));
  const other = banner(member({ draft: draft({ edited: true, editedAt: hours(2) }) }), false);
  assert.ok(other.includes(strongOther) && !other.includes(strongMine) && other.includes(es.sequences.reviewEditedTailOther));
  assert.ok(!other.includes("tocás Regenerar") && mine.includes("tocás Regenerar"), "an admin cannot regenerate, so the admin notice does not offer it");
});

test("every new review label exists in both dictionaries", () => {
  for (const k of ["reviewEditedLead", "reviewEditedStrong", "reviewEditedStrongOther", "reviewEditedRest", "reviewEditedTail", "reviewEditedTailOther", "reviewEditedRestOther", "reviewSignalsEditedLead", "reviewSignalsEditedStrong", "reviewSignalsEditedTail", "reviewSignalsEditedTailOther", "regenConfirmTailOther", "regenConfirmTitle", "regenConfirmTitleOther", "regenConfirmLead", "regenConfirmLeadOther", "regenConfirmStrong", "regenConfirmTail", "regenConfirmHelp", "regenConfirmCancel", "regenConfirmAction", "editedBy", "editedByOther"] as const) {
    assert.ok(es.sequences[k] && en.sequences[k], k);
  }
});

test("a refused review mark shows the stale warning with the button for the current text, in es and en; otherwise neither", () => {
  const html = (stale: boolean, lang = es) => renderToStaticMarkup(createElement(ReviewDialog, { open: true, onClose: () => {}, member: member(), step: 1, fromAddress: "from@example.test", schedule: DEFAULT_SCHEDULE, signals: null, now: NOW, labels: lang.sequences, ownView: true, stale, onAction: () => {}, send: SEND }));
  const on = html(true);
  assert.match(on, /class="alert alert-warn"[^>]*role="alert"/);
  assert.ok(on.includes("Este borrador cambió desde que lo abriste. Lo que ves abajo es la versión anterior."));
  assert.match(on, /<button[^>]*>Ver la versión actual<\/button>/);
  assert.ok(html(true, en).includes(en.sequences.reviewStaleNotice));
  for (const off of [html(false), render(member())]) {
    assert.ok(!off.includes(es.sequences.reviewStaleNotice));
    assert.ok(!off.includes(es.sequences.reviewStaleReload));
  }
});

// --- the footer names the act, and the act cannot discard work ---------------------------------------------------

/**
 * Both strings below are what the BD reads to know how the gate is satisfied. They used to say "open", which stopped
 * being true the moment opening no longer marked anything: the bar sent the BD to click something that unlocked
 * nothing, and the button it pointed at stayed grey with no explanation.
 */
test("the gate's copy names reviewing, never opening, in both locales", () => {
  for (const [locale, d] of [["es", es], ["en", en]] as const) {
    assert.doesNotMatch(d.sequences.bulkMissingPending, /abrir|to open/i, `${locale}: the bar must not say "open"`);
    assert.doesNotMatch(d.sequences.reviewErrors.unreviewed, /^Abrí |^Open every/i, `${locale}: the refusal must not say "open"`);
    assert.ok(d.sequences.reviewMarkReviewed.length > 0 && d.sequences.reviewMarkReviewedDirty.length > 0, `${locale}: both button strings exist`);
  }
});

/**
 * The dialog's form is UNCONTROLLED, so marking reports the STORED text. Clicking "Revisado" with unsaved edits in the
 * box marked the stored version and closed the dialog, discarding the typed text in silence — and left the draft
 * marked, so a bulk approval would then send the text the BD believed they had replaced. The button is disabled while
 * the form is dirty, and its title says why. A clean form renders it enabled, asserted below; the dirty case is
 * a client state change that static rendering cannot drive, so its contract is pinned through the title string.
 */
test("the unsaved-edits title explains that marking reports the stored text, not what is being typed", () => {
  assert.match(es.sequences.reviewMarkReviewedDirty, /sin guardar/i);
  assert.match(es.sequences.reviewMarkReviewedDirty, /guardad/i, "and it says to save first");
  assert.match(en.sequences.reviewMarkReviewedDirty, /unsaved/i);
  assert.match(en.sequences.reviewMarkReviewedDirty, /save/i);
});

test("saving no longer tells the BD to reopen the draft: reopening never marked anything", () => {
  assert.doesNotMatch(es.sequences.toastSaved, /abrirlo de nuevo/i);
  assert.doesNotMatch(en.sequences.toastSaved, /open it again/i);
});

test("a clean form renders the Revisado button enabled, carrying the help title and not the unsaved-edits one", () => {
  const html = render(member({ draft: draft({ reviewedAt: null }) }));
  assert.ok(html.includes(es.sequences.reviewMarkReviewed), "the button is there to satisfy the gate");
  assert.ok(html.includes(es.sequences.reviewMarkReviewedHelp), "and explains what it unlocks");
  assert.ok(!html.includes(es.sequences.reviewMarkReviewedDirty), "a clean form is never the unsaved-edits case");
});

/**
 * The form is UNCONTROLLED (`defaultValue`), so fresh props never reach the DOM inputs; only a remount re-seeds them,
 * and the only thing that remounts is `reads` advancing in reloadReducer, which ignores every event while `pending` is
 * null. So any in-dialog action that REWRITES the stored draft has to arm the reload first, or the new text sits in
 * the props invisibly until the dialog is closed and reopened.
 *
 * The owner hit this regenerating a subject. It cannot be reproduced by rendering, because it needs a click and then a
 * prop change, and these dialog tests render to static markup. Pinned at the source instead: both callers go through
 * `armReload`, and nothing dispatches the click behind its back.
 */
import { readFileSync } from "node:fs";

const dialogSource = readFileSync("src/app/(app)/sequences/_components/ReviewDialog.tsx", "utf8");

test("every in-dialog action that rewrites the draft arms the reload, and only armReload dispatches the click", () => {
  const clicks = dialogSource.match(/dispatch\(\{\s*type:\s*"click"/g) ?? [];
  assert.equal(clicks.length, 1, "the click is dispatched in exactly one place: armReload");
  assert.match(dialogSource, /function armReload\(\)/, "the helper exists, so the two callers cannot drift");

  for (const [what, handler] of [
    ["regenerateSubject", /onClick=\{\(\) => \{ armReload\(\); onAction\(\{ type: "regenerateSubject"/],
    ["reloadCurrent", /onClick=\{\(\) => \{ armReload\(\); onAction\(\{ type: "reloadCurrent"/],
  ] as const) {
    assert.match(dialogSource, handler, `${what} must arm the reload before the action`);
  }
});

test("the reload timeout does not run while a generation is in flight", () => {
  // Ten seconds is right for a refetch and far too short for a model call. A timeout firing mid-generation clears
  // `pending`, and the refreshed subject then arrives to an idle reducer that drops it - the original bug, intermittent.
  assert.match(dialogSource, /if \(!pending \|\| generating\) return;/);
  assert.match(dialogSource, /\}, \[pending, generating\]\);/, "generating must be a dependency, or the clock never restarts");
});

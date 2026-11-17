"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import type { ApproveResult } from "@/lib/sequences/approvalQueries";
import { parseBannedVocabularyReason } from "@/lib/sequences/approvalChecks";
import type { SequenceDetail } from "@/lib/sequences/detailQueries";
import { approveStep, cardStep, gateRows, mismatchedNames, prunedSelection, readyMemberIds, refusalKey, reminderGateRows, runReviewIntent, selectionStep, summarizeRefusals } from "@/lib/sequences/detailFlow";
import type { SkippedEdit } from "@/lib/sequences/draftCompose";
import type { SendControlLabels } from "@/lib/sendSchedule/labels";
import type { SendChoice } from "@/lib/sequences/sendMoment";
import { releaseToast, sendRecipients, type ReleaseToast } from "@/lib/sequences/sendUi";
import { DAILY_SEND_CAP_CEILING } from "@/lib/sequences/capValidation";
import { optOutErrorKey } from "@/lib/sequences/contactContext";
import { memberLanguage } from "@/lib/sequences/audienceCard";
import { choiceToStore } from "@/lib/sequences/languageChoice";
import type { AudienceLanguage } from "@/lib/sequences/complianceAudience";
import { generationLock } from "@/lib/sequences/generationLock";
import { isReadOnlyAction, isReadOnlyView } from "@/lib/sequences/readOnly";
import { updateContactPropertyAction } from "@/app/(app)/contacts/actions";
import { agoText, fill, miamiWhen, type SequenceLabels } from "@/lib/sequences/viewText";
import {
  addMembers as _unused,
  advanceReminder,
  approveBulk,
  approveMember,
  cancelApproval,
  regenerateSequenceSubject,
  chooseDraftLanguage,
  keepDraftLanguage,
  savePreferredDraftLanguage,
  clearDraftLanguage,
  generateMemberDraft,
  loadReviewSignals,
  markDraftReviewed,
  recordOptOut,
  regenerateSequenceDrafts,
  regenerateSequenceReminder,
  reinstateMember,
  removeMembers,
  rescheduleMember,
  saveSequenceDraft,
  updateSequenceSettings,
} from "../actions";
import { BulkBar, RemoveReasonDialog, ReminderBulkBar } from "../_components/BulkBar";
import { EditSequenceDialog } from "../_components/EditSequenceDialog";
import { LanguageChoiceDialog } from "../_components/LanguageChoiceDialog";
import { OptOutDialog } from "../_components/OptOutDialog";
import { RegenerateConfirmDialog } from "../_components/RegenerateConfirmDialog";
import { ReviewDialog } from "../_components/ReviewDialog";
import { SequenceDetailView } from "../_components/SequenceDetailView";
import type { BulkAction, DetailAction, ReviewAction } from "../_components/actions";
import type { SequenceSendContext } from "../_components/sendContext";
import type { ReleaseOutcome } from "../actions";

type Review = { memberId: string; step: 1 | 2; signals: string[] | null };
type Batch = { ok: true; generated: string[]; failed: string[] } | { ok: false };

/**
 * The container of /sequences/[id]. The components report intent; this turns each intent into the existing server
 * action (src/app/(app)/sequences/actions.ts), owns the dialogs, and refetches the page after anything that changes it.
 * Every decision with a rule behind it lives in src/lib/sequences/detailFlow.ts (tested); what is left here is wiring.
 *
 * Dialogs close on success and stay open with the error on failure. Card actions without a dialog report through a toast.
 */
export function SequenceDetailScreen({ detail, labels: l, sendLabels, now, viewerBdId, optOutPhrases }: { detail: SequenceDetail; labels: SequenceLabels; sendLabels: SendControlLabels; now: Date; viewerBdId: string; optOutPhrases: Record<string, string> }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleKey, setStaleKey] = useState<string | null>(null);
  const reviewKey = (memberId: string, step: 1 | 2) => `${memberId}:${step}`;
  // The reason a split-button popover keeps open with (a card or the bulk bar): separate from the dialogs' own `error`.
  const [sendError, setSendError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [removeIds, setRemoveIds] = useState<string[] | null>(null);
  const [optOutId, setOptOutId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  // A "Regenerar" the server refused because the draft is hand-edited waits here for confirmation.
  const [regen, setRegen] = useState<{ skipped: SkippedEdit; step: 1 | 2; review: boolean } | null>(null);
  // The language question asked before every generate/regenerate; `review` = it was opened from the review dialog's "Regenerar".
  const [lang, setLang] = useState<{ memberId: string; mode: "generate" | "regenerate"; review: boolean } | null>(null);
  const [langError, setLangError] = useState<string | null>(null);
  const readOnly = isReadOnlyView(viewerBdId, detail.ownerBdId);
  const ownView = !readOnly;
  const member = (id: string) => detail.members.find((m) => m.memberId === id) ?? null;
  const reviewed = review ? member(review.memberId) : null;

  const fail = (message: string = l.actionFailed) => showToast(message, "error");
  /** Runs one server call with the busy flag; a thrown error is the generic failure, never an unhandled rejection. */
  async function guarded<T>(work: () => Promise<T>, onError: (message: string) => void = fail): Promise<T | undefined> {
    setBusy(true);
    try {
      return await work();
    } catch {
      onError(l.actionFailed);
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  /**
   * Runs one draft generation or regeneration with `generatingId` set, which locks every other generate affordance and shows
   * the banner (generationLock.ts). It deliberately does NOT raise `busy`: that flag disables the send controls of EVERY card,
   * and approving another contact's draft is allowed while this one is written. A thrown error is the generic failure and
   * the id is always cleared, so the banner disappears on success AND on failure.
   */
  async function whileGenerating<T>(memberId: string, work: () => Promise<T>, onError: (message: string) => void = fail): Promise<T | undefined> {
    setGeneratingId(memberId);
    try {
      return await work();
    } catch {
      onError(l.actionFailed);
      return undefined;
    } finally {
      setGeneratingId(null);
    }
  }
  const closeDialogs = () => { setReview(null); setRemoveIds(null); setOptOutId(null); setEditing(false); setRegen(null); setLang(null); setLangError(null); setError(null); setSendError(null); setStaleKey(null); };
  // A reason can carry a detail after a colon (banned_vocabulary:<terms>); the dictionary is keyed by what precedes it.
  const reasonText = (reason: string) => {
    const bannedTerms = parseBannedVocabularyReason(reason);
    if (bannedTerms !== null) return fill(l.reviewErrors.banned_vocabulary, { term: bannedTerms });
    return (l.reviewErrors as Record<string, string>)[reason] ?? l.reviewErrors.failed;
  };

  /**
   * A bulk refusal names who was refused. One sentence per reason, joined by a space: the popover shows it in a plain
   * block that wraps and never clamps, and a line break would collapse anyway.
   */
  const bulkRefusalText = (refused: Extract<ApproveResult, { ok: false }>) => {
    if (refused.error === "too_many") return reasonText("too_many");
    const text = summarizeRefusals(refused.rejected, detail.members)
      .map((g) => {
        // A group with no nameable member (a stale or forged id) is the reason alone: "Affected: +1 more" names nobody.
        if (!g.names.length) return reasonText(g.reason);
        const names = [...g.names, ...(g.more > 0 ? [fill(l.bulkRefusedMore, { n: g.more })] : [])];
        return fill(l.bulkRefusedLine, { reason: reasonText(g.reason), names: names.join(", ") });
      })
      .join(" ");
    // An empty string is falsy: the popover would show nothing at all.
    return text || reasonText("failed");
  };

  const toastFor = (t: ReleaseToast) => {
    const text: Record<ReleaseToast["key"], string> = {
      sentNow: l.toastSentNow,
      sentNowMany: "n" in t ? fill(l.toastSentNowMany, { n: t.n }) : l.toastSentNow,
      capDeferred: l.toastCapDeferred,
      capDeferredMany: "sent" in t ? fill(l.toastCapDeferredMany, { sent: t.sent, n: t.n }) : l.toastCapDeferred,
      held: l.toastHeldNow,
      pending: l.toastSendPending,
      failed: l.actionFailed,
    };
    showToast(text[t.key], t.tone);
  };
  /** After an approval or a move: "now" says what the immediate release did; anything else says it was approved or scheduled. */
  const toastApproval = (when: SendChoice, count: number, release: ReleaseOutcome | undefined, step: 1 | 2 = 1) => {
    if (when.kind === "now") return toastFor(releaseToast(release, count));
    // Reminders are not drafts, and a bulk of them cannot name one date: each follows its own member's cadence.
    // The single-reminder path says the date because it has only one; this one says the cadence instead.
    if (step === 2) return showToast(count > 1 ? fill(l.toastRemindersApprovedMany, { n: count }) : l.toastRemindersApprovedOne, "success");
    if (count > 1) return showToast(fill(l.toastApprovedMany, { n: count }), "success");
    showToast(when.kind === "at" ? l.toastScheduledOne : l.toastApproved, "success");
  };

  /** One server call for a card (one member) or the bulk bar (several, gated). Resolves `true` when it worked, which closes the popover. */
  async function approveWith(ids: string[], when: SendChoice, bulk: boolean, step: 1 | 2 = 1): Promise<boolean> {
    setSendError(null);
    // A reminder approval carries no send choice (they follow the cadence), so the server gets `undefined`, as the single-card path does.
    const r = await guarded(() => (bulk ? approveBulk(ids, step, step === 2 ? undefined : when) : approveMember(ids[0]!, step, when)), setSendError);
    if (!r) return false;
    if (!r.ok) {
      const message = bulk ? bulkRefusalText(r) : reasonText(refusalKey(r));
      // The message goes out BEFORE the refresh and ALSO as a toast. `sendError` is only rendered inside the send
      // popover, so a refresh that remounts the card takes the one place it would have been read with it — the BD
      // then sees an approval that did nothing and says nothing. A refusal is the screen's answer, not a detail:
      // "Al borrador le falta el pie de baja…" is what tells them to regenerate. Found 2026-10-28, when a stale
      // Mar del Plata footer on a contact whose audience had moved to Miami refused silently.
      setSendError(message);
      fail(message);
      router.refresh();
      return false;
    }
    router.refresh();
    toastApproval(when, ids.length, r.release, step);
    if (bulk) setSelected([]);
    return true;
  }

  async function reschedule(memberId: string, when: SendChoice): Promise<boolean> {
    setSendError(null);
    const r = await guarded(() => rescheduleMember(memberId, when), setSendError);
    if (!r) return false;
    if (!r.ok) {
      // Same ordering as approveWith: the message is set before the refresh that can remount the popover holding it.
      const message = reasonText(r.error);
      setSendError(message);
      if (when.kind === "now") fail(message);
      router.refresh();
      return false;
    }
    router.refresh();
    if (when.kind === "now") toastFor(releaseToast(r.release, 1));
    else showToast(l.toastRescheduled, "success");
    return true;
  }

  async function reportBatch(result: Batch | undefined, one: string, many: string) {
    if (!result?.ok) return fail();
    if (result.generated.length > 0) showToast(result.generated.length === 1 ? one : fill(many, { n: result.generated.length }), "success");
    if (result.failed.length > 0) fail(fill(l.toastGenerateFailed, { n: result.failed.length }));
    router.refresh();
  }

  /**
   * Regenerating is one-to-one (card menu and review dialog). It always starts with NO confirmation: the server is the
   * boundary, it leaves a hand-edited draft alone and reports it in `skippedEdited`, and only THAT report (never this
   * page's possibly stale copy) feeds the confirmation. Confirming re-calls for that member with the instant of the text
   * shown; if the server reports an edit again, the dialog opens again instead of looping silently.
   */
  async function regenerateOne(memberId: string, confirmed: Record<string, number> = {}) {
    const r = await whileGenerating(memberId, () => regenerateSequenceDrafts(detail.id, [memberId], confirmed));
    if (r?.ok && r.skippedEdited[0]) setRegen({ skipped: r.skippedEdited[0], step: 1, review: false });
    return reportBatch(r, l.toastRegenerated, l.toastRegeneratedMany);
  }

  /** One draft at a time: this card reads "Generando…" and every other generate control waits until the call returns. */
  async function generateOne(memberId: string) {
    const r = await whileGenerating(memberId, () => generateMemberDraft(detail.id, memberId));
    if (r?.ok && r.generated.length === 0 && r.failed.length === 0) showToast(l.toastGeneratedNone, "success");
    await reportBatch(r, l.toastGeneratedOne, l.toastGeneratedOne);
  }

  /** Opens the language question. A HOLD (no audience) or a generation in flight never gets it: neither may start a draft. */
  function askLanguage(memberId: string, mode: "generate" | "regenerate", review = false) {
    if (!member(memberId)?.audience?.audience || lock.active) return;
    setLangError(null);
    setLang({ memberId, mode, review });
  }

  /**
   * Stores the choice, then generates with it (the server reads it back). Saved as the contact's preferred language it lives on the
   * contact and this member keeps no one-off; otherwise it is stored on the member only when it differs from what the system resolves
   * (the preferred language when there is one).
   */
  async function confirmLanguage(selected: AudienceLanguage, saveAsPreferred: boolean) {
    const m = lang ? member(lang.memberId) : null;
    const current = m ? memberLanguage(m) : null;
    if (!lang || !m || !current) return;
    const step = saveAsPreferred ? ({ action: "preferred", language: selected } as const) : choiceToStore(current.baseline, m.languageChoice?.language ?? null, selected);
    setLangError(null);
    if (step.action !== "none") {
      const r = await guarded(() => (step.action === "preferred" ? savePreferredDraftLanguage(m.memberId, step.language) : step.action === "set" ? chooseDraftLanguage(m.memberId, step.language) : clearDraftLanguage(m.memberId)), setLangError);
      if (!r) return;
      if (!r.ok) return setLangError(l.languageChoice.saveFailed);
      router.refresh();
    }
    const { memberId, mode, review } = lang;
    setLang(null);
    if (review) return void reviewRegenerate({ type: "regenerate", memberId, step: 1 });
    return void (mode === "generate" ? generateOne(memberId) : regenerateOne(memberId));
  }

  /** "Mantener en {idioma}": the SERVER reads the stored draft's language and records it as this member's one-off choice, or refuses when the screen is stale (nothing to keep). */
  async function keepLanguage(memberId: string): Promise<boolean> {
    const r = await guarded(() => keepDraftLanguage(memberId));
    router.refresh();
    if (!r?.ok) { fail(r && r.error === "no_mismatch" ? l.languageMismatch.keepRefused : l.languageChoice.saveFailed); return false; }
    showToast(fill(l.languageMismatch.toastKept, { draft: r.language === "es" ? l.audience.langEs : l.audience.langEn }), "success");
    return true;
  }

  async function openReview(memberId: string, step: 1 | 2) {
    setError(null);
    // The chips are the generator's own input, read on demand: opening with an empty list would say "no signals" for a draft that had some.
    const signals = ownView ? await guarded(() => loadReviewSignals(memberId, step)) : null;
    if (ownView && signals === undefined) return;
    setReview({ memberId, step, signals: signals ?? null });
  }

  function onAction(a: DetailAction): void | Promise<boolean | void> {
    // The server refuses every write on a foreign Sequence; the screen does not even try.
    if (readOnly && !isReadOnlyAction(a.type)) return;
    switch (a.type) {
      case "editSequence": return setEditing(true);
      case "changeCadence": return showToast(fill(l.toastCadenceFixed, { n: detail.schedule.step2.afterDays }), "success");
      case "createNext": return router.push("/sequences/new");
      case "approveReady": return setSelected(readyMemberIds(detail.members));
      case "generate": return askLanguage(a.memberId, "generate");
      case "reviewDraft": case "viewDraft": case "viewEmail": case "viewSent": case "reviewReminder": case "viewReminder": return void openReview(a.memberId, cardStep(a.type));
      case "remove": return setRemoveIds([a.memberId]);
      case "optOut": return setOptOutId(a.memberId);
      case "regenerate": return askLanguage(a.memberId, "regenerate");
      // No language step: the body stays as it is, so the language of the email is already settled and asking again
      // would offer a choice that cannot be honoured without rewriting the body this action promises to leave alone.
      // It calls the model, so it takes the same generation lock as a full regenerate: without it two generations could
      // run on one card at once, which is exactly what that lock exists to prevent.
      case "regenerateSubject":
        return void guarded(() => whileGenerating(a.memberId, () => regenerateSequenceSubject(detail.id, a.memberId))).then((r) => {
          if (!r) return;
          if (r.ok) showToast(l.toastSubjectRegenerated, "success");
          else if (r.error === "edited") showToast(l.toastSubjectEdited, "error");
          else fail();
          router.refresh();
        });
      case "chooseLanguage": return askLanguage(a.memberId, member(a.memberId)?.draft ? "regenerate" : "generate");
      case "keepLanguage": return void keepLanguage(a.memberId);
      case "setPersonCountry":
        return guarded(() => updateContactPropertyAction(a.personId, "country", a.country)).then((r) => { if (!r?.ok) return false; router.refresh(); return true; });
      case "setLanguage": return void guarded(() => chooseDraftLanguage(a.memberId, a.language)).then((r) => { if (!r) return; if (!r.ok) fail(l.languageChoice.saveFailed); router.refresh(); });
      case "resetLanguage": return void guarded(() => clearDraftLanguage(a.memberId)).then((r) => { if (!r) return; if (r.ok) showToast(l.languageChoice.toastReset, "success"); else fail(); router.refresh(); });
      case "approveWith": return approveWith([a.memberId], a.when, false);
      case "reschedule": return reschedule(a.memberId, a.when);
      case "sendNow": return void reschedule(a.memberId, { kind: "now" });
      case "cancelSchedule": return void guarded(() => cancelApproval(a.memberId, 1)).then((r) => { if (!r) return; if (r.ok) showToast(l.toastCancelled, "success"); else fail(); router.refresh(); });
      case "approve": {
        const m = member(a.memberId);
        if (!m) return;
        return void guarded(() => approveMember(a.memberId, approveStep(m, now))).then((r) => {
          if (!r) return;
          if (r.ok) {
            // A reminder's send instant is computed and stored at approval: say the date instead of "next send".
            if (r.scheduledFor) { const w = miamiWhen(r.scheduledFor, now); showToast(fill(l.toastReminderApproved, { date: w.ddmm, time: w.hhmm }), "success"); }
            else showToast(l.toastApproved, "success");
          } else fail(reasonText(refusalKey(r)));
          router.refresh();
        });
      }
      case "cancelReminder": return void guarded(() => cancelApproval(a.memberId, 2)).then((r) => { if (!r) return; if (r.ok) showToast(l.toastReminderCancelled, "success"); else fail(); router.refresh(); });
      case "cancel": return void guarded(() => cancelApproval(a.memberId, 1)).then((r) => { if (!r) return; if (r.ok) showToast(l.toastCancelled, "success"); else fail(); router.refresh(); });
      case "advanceReminder": return void guarded(() => advanceReminder(a.memberId)).then((r) => { if (!r) return; if (r.ok) showToast(l.toastAdvanced, "success"); else fail(); router.refresh(); });
      // The reminder fell due and was never written — its generation failed when step 1 went out and nothing retried.
      // regenerateSequenceReminder creates it: for step 2 it only requires that step 1 exists, which it does here.
      // Takes the generation lock like every other model call on this screen.
      case "generateReminder":
        return void guarded(() => whileGenerating(a.memberId, () => regenerateSequenceReminder(detail.id, a.memberId))).then((r) => {
          if (!r) return;
          if (r.ok) showToast(l.toastReminderGenerated, "success");
          else fail();
          router.refresh();
        });
      case "readmit": return void guarded(() => reinstateMember(a.memberId)).then((r) => { if (!r) return; if (r.ok) showToast(l.toastReadmitted, "success"); else fail((l.reinstateErrors as Record<string, string>)[r.error] ?? l.actionFailed); router.refresh(); });
      default: return;
    }
  }

  /** The review dialog's "Regenerar" (after the language question for step 1; a step 2 reminder reuses the stored choice). */
  async function reviewRegenerate(a: Extract<ReviewAction, { type: "regenerate" }>) {
    const confirmed = a.confirmedEdits ?? {};
    const r = await guarded(() => whileGenerating(a.memberId, () => (a.step === 2 ? regenerateSequenceReminder(detail.id, a.memberId, confirmed) : regenerateSequenceDrafts(detail.id, [a.memberId], confirmed)), setError), setError);
    if (!r) return;
    if (r.ok && r.skippedEdited[0]) return setRegen({ skipped: r.skippedEdited[0], step: a.step, review: true });
    if (r.ok && r.generated.length > 0) { showToast(l.toastRegenerated, "success"); closeDialogs(); } else setError(l.actionFailed);
    return router.refresh();
  }

  async function onReview(a: ReviewAction) {
    if (readOnly) return;
    const m = member(a.memberId);
    if (!m) return;
    // Same path as the card menu's entry, so the two cannot drift: one action, one set of guards, one toast.
    if (a.type === "regenerateSubject") return void onAction(a);
    if (a.type === "markReviewed") {
      // The BD clicked "Revisado". Refetch on success, or the bar's "N de M revisados" and the approve gate stay stale, and close.
      const r = await markDraftReviewed(a.memberId, a.step, a.version).catch(() => null);
      if (r?.ok) { setStaleKey(null); router.refresh(); closeDialogs(); }
      // Refused: the text on screen is not the stored one. The draft stays unreviewed and the dialog says so.
      else if (r && r.error === "stale") setStaleKey(reviewKey(a.memberId, a.step));
      else setError(l.actionFailed);
      return;
    }
    if (a.type === "keepLanguage") return void (await keepLanguage(a.memberId));
    if (a.type === "reloadCurrent") {
      // Clear the notice HERE. It used to be cleared by the mark that the old open-effect re-reported automatically;
      // now only the button marks, so nothing answered and the notice outlived the reload it was about - the dialog
      // kept saying "what you see below is the previous version" ON TOP of the text it had just refetched.
      setStaleKey(null);
      router.refresh();
      return;
    }
    if (a.type === "regenerate") return a.step === 1 && !a.confirmedEdits ? askLanguage(a.memberId, "regenerate", true) : reviewRegenerate(a);
    if (!("subject" in a)) return;
    const { type: intent, memberId, step, subject, body } = a;
    const stored = (step === 2 ? m.reminderDraft : m.draft) ?? { subject: "", body: "" };
    const when = a.type === "approve" ? a.when : undefined;
    let release: ReleaseOutcome | undefined;
    let scheduledFor: Date | undefined;
    const result = await guarded(() => runReviewIntent(intent, { stored: { subject: stored.subject, body: stored.body }, text: { subject, body } }, {
      save: () => saveSequenceDraft(memberId, { subject, body }, step),
      approve: async () => {
        const approved = await approveMember(memberId, step, when);
        if (approved.ok) { release = approved.release; scheduledFor = approved.scheduledFor; }
        return approved;
      },
    }), setError);
    if (!result) return;
    // Always refresh once the server was reached: approving an untouched draft persists nothing client-side but
    // still changes the member's state, and the card must move without a manual reload.
    router.refresh();
    if (result.ok) {
      if (intent === "save") showToast(l.toastSaved, "success");
      else if (when) toastApproval(when, 1, release);
      else if (scheduledFor) { const w = miamiWhen(scheduledFor, now); showToast(fill(l.toastReminderApproved, { date: w.ddmm, time: w.hhmm }), "success"); }
      else showToast(l.toastApproved, "success");
      closeDialogs();
    } else setError(reasonText(result.error));
  }

  async function onBulk(a: BulkAction): Promise<boolean | void> {
    if (readOnly) return;
    if (a.type === "remove") return setRemoveIds(a.memberIds);
    // `when` is ignored for step 2 (see approveWith); the cadence choice only feeds the toast wording.
    if (a.type === "approveReminders") return approveWith(a.memberIds, { kind: "cadence" }, true, 2);
    return approveWith(a.memberIds, a.when, true);
  }

  async function onRemove(reason: string) {
    const ids = removeIds ?? [];
    const r = await guarded(() => removeMembers(detail.id, ids, reason), setError);
    if (!r) return;
    if (!r.ok) return setError(l.actionFailed);
    const skipped = r.rejected.length;
    showToast(skipped > 0 ? fill(l.toastRemovedSome, { n: r.removed.length, skipped }) : r.removed.length === 1 ? l.toastRemovedOne : fill(l.toastRemoved, { n: r.removed.length }), "success");
    setSelected((s) => s.filter((id) => !r.removed.includes(id)));
    closeDialogs();
    router.refresh();
  }

  async function onOptOut() {
    if (!optOutId) return;
    const r = await guarded(() => recordOptOut(optOutId), setError);
    if (!r) return;
    if (!r.ok) return setError(l[optOutErrorKey(r.error)]);
    showToast(r.discarded === 1 ? l.toastOptOutOne : fill(l.toastOptOut, { n: r.discarded }), "success");
    closeDialogs();
    router.refresh();
  }

  async function onEdit(patch: { name: string; dailySendCap: number }) {
    const r = await guarded(() => updateSequenceSettings(detail.id, patch), setError);
    if (!r) return;
    if (!r.ok) return setError(r.error === "name_required" ? l.newNameError : fill(l.newCapInvalid, { max: DAILY_SEND_CAP_CEILING }));
    showToast(l.toastEdited, "success");
    closeDialogs();
    router.refresh();
  }

  const optOutMember = optOutId ? member(optOutId) : null;
  // What this screen can count: the live members of THIS Sequence that share the address. The dialog words it as "acá ves".
  const optOutLive = optOutMember ? detail.members.filter((m) => m.state !== "discarded" && m.email?.trim().toLowerCase() === optOutMember.email?.trim().toLowerCase()).length : 0;
  // Computed once: the cards, the banner, the bulk bar and the dialog all read this one value.
  const lock = generationLock(generatingId, detail.members, l.unnamed);
  const step = selectionStep(detail.members, selected, now);
  const rows = step === 2 ? reminderGateRows(detail.members, selected, now) : gateRows(detail.members, selected);
  const prune = prunedSelection(rows, selected);
  useEffect(() => { if (prune) setSelected(prune); });
  const send: SequenceSendContext = { labels: sendLabels, schedule: detail.schedule, busy, error: sendError };
  const selectedMembers = detail.members.filter((m) => selected.includes(m.memberId));

  return (
    <>
      <SequenceDetailView
        detail={detail} labels={l} send={send} now={now} onAction={onAction} viewerBdId={viewerBdId} optOutPhrases={optOutPhrases}
        lock={lock} selected={new Set(selected)} selectionStep={step} onToggle={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
        bulk={readOnly ? undefined : (g) => step === 2 ? <ReminderBulkBar lock={g} selection={rows} labels={l} onAction={onBulk} /> : <BulkBar lock={g} selection={rows} labels={l} onAction={onBulk} send={send} recipients={sendRecipients(selectedMembers)} cap={{ cap: detail.dailySendCap, sentToday: detail.sentToday }} now={now} mismatched={mismatchedNames(detail.members)} />}
      />
      <ReviewDialog open={review !== null && reviewed !== null} onClose={closeDialogs} member={reviewed} step={review?.step ?? 1} fromAddress={detail.fromAddress} readOnly={readOnly} ownerName={detail.ownerName} schedule={detail.schedule} signals={review?.signals ?? null} now={now} labels={l} ownView={ownView} onAction={onReview} busy={busy} regenerateLocked={lock.active} generating={reviewed !== null && lock.card(reviewed.memberId).busyHere} error={error} stale={review !== null && staleKey === reviewKey(review.memberId, review.step)} send={{ ...send, error }} />
      <RemoveReasonDialog open={removeIds !== null} count={removeIds?.length ?? 0} labels={l} onClose={closeDialogs} onConfirm={onRemove} busy={busy} error={error} />
      <OptOutDialog open={optOutId !== null} email={optOutMember?.email ?? null} ownLiveCount={optOutLive} labels={l} onClose={closeDialogs} onConfirm={onOptOut} busy={busy} error={error} />
      {regen && (
        <RegenerateConfirmDialog open labels={l} ownView={ownView} ago={agoText(new Date(regen.skipped.editedAt), now, l)}
          onCancel={() => setRegen(null)}
          onConfirm={() => {
            const r = regen;
            const confirmed = { [r.skipped.memberId]: r.skipped.editedAt };
            setRegen(null);
            if (r.review) void onReview({ type: "regenerate", memberId: r.skipped.memberId, step: r.step, confirmedEdits: confirmed });
            else void regenerateOne(r.skipped.memberId, confirmed);
          }} />
      )}
      {lang && member(lang.memberId) && (
        <LanguageChoiceDialog key={lang.memberId} member={member(lang.memberId)!} name={[member(lang.memberId)!.firstName, member(lang.memberId)!.lastName].filter(Boolean).join(" ") || l.unnamed} mode={lang.mode} labels={l}
          busy={busy} locked={lock.active} error={langError} onCancel={() => { setLang(null); setLangError(null); }} onConfirm={(language, saveAsPreferred) => void confirmLanguage(language, saveAsPreferred)} />
      )}
      {editing && <EditSequenceDialog open name={detail.name} cap={detail.dailySendCap} labels={l} onClose={closeDialogs} onSave={onEdit} busy={busy} error={error} />}
    </>
  );
}

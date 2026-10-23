"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ToastProvider";
import type { ApproveResult } from "@/lib/sequences/approvalQueries";
import type { SequenceDetail } from "@/lib/sequences/detailQueries";
import { approveStep, cardStep, gateRows, readyMemberIds, refusalKey, runReviewIntent, summarizeRefusals } from "@/lib/sequences/detailFlow";
import type { SkippedEdit } from "@/lib/sequences/draftCompose";
import type { SendControlLabels } from "@/lib/sendSchedule/labels";
import type { SendChoice } from "@/lib/sequences/sendMoment";
import { releaseToast, sendRecipients, type ReleaseToast } from "@/lib/sequences/sendUi";
import { DAILY_SEND_CAP_CEILING } from "@/lib/sequences/capValidation";
import { optOutErrorKey } from "@/lib/sequences/contactContext";
import { choiceToStore } from "@/lib/sequences/languageChoice";
import type { AudienceLanguage } from "@/lib/sequences/complianceAudience";
import { generationLock } from "@/lib/sequences/generationLock";
import { isReadOnlyAction, isReadOnlyView } from "@/lib/sequences/readOnly";
import { agoText, fill, type SequenceLabels } from "@/lib/sequences/viewText";
import {
  addMembers as _unused,
  advanceReminder,
  approveBulk,
  approveMember,
  cancelApproval,
  chooseDraftLanguage,
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
import { BulkBar, RemoveReasonDialog } from "../_components/BulkBar";
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
  const closeDialogs = () => { setReview(null); setRemoveIds(null); setOptOutId(null); setEditing(false); setRegen(null); setLang(null); setLangError(null); setError(null); setSendError(null); };
  const reasonText = (reason: string) => (l.reviewErrors as Record<string, string>)[reason] ?? l.reviewErrors.failed;

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
  const toastApproval = (when: SendChoice, count: number, release: ReleaseOutcome | undefined) => {
    if (when.kind === "now") return toastFor(releaseToast(release, count));
    if (count > 1) return showToast(fill(l.toastApprovedMany, { n: count }), "success");
    showToast(when.kind === "at" ? l.toastScheduledOne : l.toastApproved, "success");
  };

  /** One server call for a card (one member) or the bulk bar (several, gated). Resolves `true` when it worked, which closes the popover. */
  async function approveWith(ids: string[], when: SendChoice, bulk: boolean): Promise<boolean> {
    setSendError(null);
    const r = await guarded(() => (bulk ? approveBulk(ids, 1, when) : approveMember(ids[0]!, 1, when)), setSendError);
    if (!r) return false;
    router.refresh();
    if (!r.ok) {
      setSendError(bulk ? bulkRefusalText(r) : reasonText(refusalKey(r)));
      return false;
    }
    toastApproval(when, ids.length, r.release);
    if (bulk) setSelected([]);
    return true;
  }

  async function reschedule(memberId: string, when: SendChoice): Promise<boolean> {
    setSendError(null);
    const r = await guarded(() => rescheduleMember(memberId, when), setSendError);
    if (!r) return false;
    router.refresh();
    if (!r.ok) {
      const message = reasonText(r.error);
      setSendError(message);
      if (when.kind === "now") fail(message);
      return false;
    }
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

  /** Stores the choice only when it differs from what is already recorded, then generates with it (the server reads it back). */
  async function confirmLanguage(selected: AudienceLanguage) {
    const m = lang ? member(lang.memberId) : null;
    const resolved = m?.audience?.audience?.language;
    if (!lang || !m || !resolved) return;
    const step = choiceToStore(resolved, m.languageChoice?.language ?? null, selected);
    setLangError(null);
    if (step.action !== "none") {
      const r = await guarded(() => (step.action === "set" ? chooseDraftLanguage(m.memberId, step.language) : clearDraftLanguage(m.memberId)), setLangError);
      if (!r) return;
      if (!r.ok) return setLangError(l.languageChoice.saveFailed);
      router.refresh();
    }
    const { memberId, mode, review } = lang;
    setLang(null);
    if (review) return void reviewRegenerate({ type: "regenerate", memberId, step: 1 });
    return void (mode === "generate" ? generateOne(memberId) : regenerateOne(memberId));
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
      case "chooseLanguage": return askLanguage(a.memberId, member(a.memberId)?.draft ? "regenerate" : "generate");
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
          if (r.ok) showToast(l.toastApproved, "success");
          else fail(reasonText(refusalKey(r)));
          router.refresh();
        });
      }
      case "cancel": return void guarded(() => cancelApproval(a.memberId, 1)).then((r) => { if (!r) return; if (r.ok) showToast(l.toastCancelled, "success"); else fail(); router.refresh(); });
      case "advanceReminder": return void guarded(() => advanceReminder(a.memberId)).then((r) => { if (!r) return; if (r.ok) showToast(l.toastAdvanced, "success"); else fail(); router.refresh(); });
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
    if (a.type === "markReviewed") {
      // The dialog reports once per open. Refetch on success, or the bar's "N de M revisados" and the approve gate stay stale.
      const r = await markDraftReviewed(a.memberId, a.step).catch(() => null);
      if (r?.ok) router.refresh();
      return;
    }
    if (a.type === "regenerate") return a.step === 1 && !a.confirmedEdits ? askLanguage(a.memberId, "regenerate", true) : reviewRegenerate(a);
    if (!("subject" in a)) return;
    const { type: intent, memberId, step, subject, body } = a;
    const stored = (step === 2 ? m.reminderDraft : m.draft) ?? { subject: "", body: "" };
    const when = a.type === "approve" ? a.when : undefined;
    let release: ReleaseOutcome | undefined;
    const result = await guarded(() => runReviewIntent(intent, { stored: { subject: stored.subject, body: stored.body }, text: { subject, body } }, {
      save: () => saveSequenceDraft(memberId, { subject, body }, step),
      approve: async () => {
        const approved = await approveMember(memberId, step, when);
        if (approved.ok) release = approved.release;
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
      else showToast(l.toastApproved, "success");
      closeDialogs();
    } else setError(reasonText(result.error));
  }

  async function onBulk(a: BulkAction): Promise<boolean | void> {
    if (readOnly) return;
    if (a.type === "remove") return setRemoveIds(a.memberIds);
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
  const rows = gateRows(detail.members, selected);
  const send: SequenceSendContext = { labels: sendLabels, schedule: detail.schedule, busy, error: sendError };
  const selectedMembers = detail.members.filter((m) => selected.includes(m.memberId));

  return (
    <>
      <SequenceDetailView
        detail={detail} labels={l} send={send} now={now} onAction={onAction} viewerBdId={viewerBdId} optOutPhrases={optOutPhrases}
        lock={lock} selected={new Set(selected)} onToggle={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
        bulk={readOnly ? undefined : (g) => <BulkBar lock={g} selection={rows} labels={l} onAction={onBulk} send={send} recipients={sendRecipients(selectedMembers)} cap={{ cap: detail.dailySendCap, sentToday: detail.sentToday }} now={now} />}
      />
      <ReviewDialog open={review !== null && reviewed !== null} onClose={closeDialogs} member={reviewed} step={review?.step ?? 1} fromAddress={detail.fromAddress} readOnly={readOnly} ownerName={detail.ownerName} schedule={detail.schedule} signals={review?.signals ?? null} now={now} labels={l} ownView={ownView} onAction={onReview} busy={busy} regenerateLocked={lock.active} error={error} send={{ ...send, error }} />
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
          busy={busy} locked={lock.active} error={langError} onCancel={() => { setLang(null); setLangError(null); }} onConfirm={(language) => void confirmLanguage(language)} />
      )}
      {editing && <EditSequenceDialog open name={detail.name} cap={detail.dailySendCap} labels={l} onClose={closeDialogs} onSave={onEdit} busy={busy} error={error} />}
    </>
  );
}

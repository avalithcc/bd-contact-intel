"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ToastProvider";
import type { SequenceDetail } from "@/lib/sequences/detailQueries";
import { approveStep, cardStep, gateRows, readyMemberIds, runReviewIntent } from "@/lib/sequences/detailFlow";
import type { SkippedEdit } from "@/lib/sequences/draftCompose";
import { DAILY_SEND_CAP_CEILING } from "@/lib/sequences/capValidation";
import { optOutErrorKey } from "@/lib/sequences/contactContext";
import { isReadOnlyAction, isReadOnlyView } from "@/lib/sequences/readOnly";
import { agoText, fill, type SequenceLabels } from "@/lib/sequences/viewText";
import {
  addMembers as _unused,
  advanceReminder,
  approveBulk,
  approveMember,
  cancelApproval,
  generateMemberDraft,
  loadReviewSignals,
  markDraftReviewed,
  recordOptOut,
  regenerateSequenceDrafts,
  regenerateSequenceReminder,
  reinstateMember,
  removeMembers,
  saveSequenceDraft,
  updateSequenceSettings,
} from "../actions";
import { BulkBar, RemoveReasonDialog } from "../_components/BulkBar";
import { EditSequenceDialog } from "../_components/EditSequenceDialog";
import { OptOutDialog } from "../_components/OptOutDialog";
import { RegenerateConfirmDialog } from "../_components/RegenerateConfirmDialog";
import { ReviewDialog } from "../_components/ReviewDialog";
import { SequenceDetailView } from "../_components/SequenceDetailView";
import type { BulkAction, DetailAction, ReviewAction } from "../_components/actions";

type Review = { memberId: string; step: 1 | 2; signals: string[] | null };
type Batch = { ok: true; generated: string[]; failed: string[] } | { ok: false };

/**
 * The container of /sequences/[id]. The components report intent; this turns each intent into the existing server
 * action (src/app/(app)/sequences/actions.ts), owns the dialogs, and refetches the page after anything that changes it.
 * Every decision with a rule behind it lives in src/lib/sequences/detailFlow.ts (tested); what is left here is wiring.
 *
 * Dialogs close on success and stay open with the error on failure. Card actions without a dialog report through a toast.
 */
export function SequenceDetailScreen({ detail, labels: l, now, viewerBdId, optOutPhrases }: { detail: SequenceDetail; labels: SequenceLabels; now: Date; viewerBdId: string; optOutPhrases: Record<string, string> }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [removeIds, setRemoveIds] = useState<string[] | null>(null);
  const [optOutId, setOptOutId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  // A "Regenerar" the server refused because the draft is hand-edited waits here for confirmation.
  const [regen, setRegen] = useState<{ skipped: SkippedEdit; step: 1 | 2; review: boolean } | null>(null);
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
  const closeDialogs = () => { setReview(null); setRemoveIds(null); setOptOutId(null); setEditing(false); setRegen(null); setError(null); };
  const reasonText = (reason: string) => (l.reviewErrors as Record<string, string>)[reason] ?? l.reviewErrors.failed;

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
    const r = await guarded(() => regenerateSequenceDrafts(detail.id, [memberId], confirmed));
    if (r?.ok && r.skippedEdited[0]) setRegen({ skipped: r.skippedEdited[0], step: 1, review: false });
    return reportBatch(r, l.toastRegenerated, l.toastRegeneratedMany);
  }

  /** One card, one draft: the button is disabled and reads "Generando…" until this member's own call returns. */
  async function generateOne(memberId: string) {
    setGeneratingId(memberId);
    const r = await guarded(() => generateMemberDraft(detail.id, memberId));
    setGeneratingId(null);
    if (r?.ok && r.generated.length === 0 && r.failed.length === 0) showToast(l.toastGeneratedNone, "success");
    await reportBatch(r, l.toastGeneratedOne, l.toastGeneratedOne);
  }

  async function openReview(memberId: string, step: 1 | 2) {
    setError(null);
    // The chips are the generator's own input, read on demand: opening with an empty list would say "no signals" for a draft that had some.
    const signals = ownView ? await guarded(() => loadReviewSignals(memberId, step)) : null;
    if (ownView && signals === undefined) return;
    setReview({ memberId, step, signals: signals ?? null });
  }

  function onAction(a: DetailAction) {
    // The server refuses every write on a foreign Sequence; the screen does not even try.
    if (readOnly && !isReadOnlyAction(a.type)) return;
    switch (a.type) {
      case "editSequence": return setEditing(true);
      case "changeCadence": return showToast(fill(l.toastCadenceFixed, { n: detail.schedule.step2.afterDays }), "success");
      case "createNext": return router.push("/sequences/new");
      case "approveReady": return setSelected(readyMemberIds(detail.members));
      case "generate": return void generateOne(a.memberId);
      case "reviewDraft": case "viewDraft": case "viewEmail": case "viewSent": case "reviewReminder": case "viewReminder": return void openReview(a.memberId, cardStep(a.type));
      case "remove": return setRemoveIds([a.memberId]);
      case "optOut": return setOptOutId(a.memberId);
      case "regenerate": return void regenerateOne(a.memberId);
      case "approve": {
        const m = member(a.memberId);
        if (!m) return;
        return void guarded(() => approveMember(a.memberId, approveStep(m, now))).then((r) => {
          if (!r) return;
          if (r.ok) showToast(l.toastApproved, "success");
          else fail(reasonText(r.rejected[0]?.reason ?? "failed"));
          router.refresh();
        });
      }
      case "cancel": return void guarded(() => cancelApproval(a.memberId, 1)).then((r) => { if (!r) return; if (r.ok) showToast(l.toastCancelled, "success"); else fail(); router.refresh(); });
      case "advanceReminder": return void guarded(() => advanceReminder(a.memberId)).then((r) => { if (!r) return; if (r.ok) showToast(l.toastAdvanced, "success"); else fail(); router.refresh(); });
      case "readmit": return void guarded(() => reinstateMember(a.memberId)).then((r) => { if (!r) return; if (r.ok) showToast(l.toastReadmitted, "success"); else fail((l.reinstateErrors as Record<string, string>)[r.error] ?? l.actionFailed); router.refresh(); });
      default: return;
    }
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
    if (a.type === "regenerate") {
      const confirmed = a.confirmedEdits ?? {};
      const r = await guarded(() => (a.step === 2 ? regenerateSequenceReminder(detail.id, a.memberId, confirmed) : regenerateSequenceDrafts(detail.id, [a.memberId], confirmed)), setError);
      if (!r) return;
      if (r.ok && r.skippedEdited[0]) return setRegen({ skipped: r.skippedEdited[0], step: a.step, review: true });
      if (r.ok && r.generated.length > 0) { showToast(l.toastRegenerated, "success"); closeDialogs(); } else setError(l.actionFailed);
      return router.refresh();
    }
    if (!("subject" in a)) return;
    const { type: intent, memberId, step, subject, body } = a;
    const stored = (step === 2 ? m.reminderDraft : m.draft) ?? { subject: "", body: "" };
    const result = await guarded(() => runReviewIntent(intent, { stored: { subject: stored.subject, body: stored.body }, text: { subject, body } }, {
      save: () => saveSequenceDraft(memberId, { subject, body }, step),
      approve: () => approveMember(memberId, step),
    }), setError);
    if (!result) return;
    if (result.persisted) router.refresh();
    if (result.ok) { showToast(intent === "save" ? l.toastSaved : l.toastApproved, "success"); closeDialogs(); } else setError(reasonText(result.error));
  }

  async function onBulk(a: BulkAction) {
    if (a.type === "remove") return setRemoveIds(a.memberIds);
    const r = await guarded(() => approveBulk(a.memberIds, 1));
    if (!r) return;
    if (r.ok) { showToast(fill(l.toastApprovedMany, { n: r.approved.length }), "success"); setSelected([]); } else fail(reasonText(r.rejected[0]?.reason ?? "failed"));
    router.refresh();
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
  const rows = gateRows(detail.members, selected);

  return (
    <>
      <SequenceDetailView
        detail={detail} labels={l} now={now} onAction={onAction} viewerBdId={viewerBdId} optOutPhrases={optOutPhrases}
        generatingId={generatingId} selected={new Set(selected)} onToggle={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
        bulk={readOnly ? null : <BulkBar selection={rows} labels={l} onAction={onBulk} />}
      />
      <ReviewDialog open={review !== null && reviewed !== null} onClose={closeDialogs} member={reviewed} step={review?.step ?? 1} fromAddress={detail.fromAddress} readOnly={readOnly} ownerName={detail.ownerName} schedule={detail.schedule} signals={review?.signals ?? null} now={now} labels={l} ownView={ownView} onAction={onReview} busy={busy} error={error} />
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
      {editing && <EditSequenceDialog open name={detail.name} cap={detail.dailySendCap} labels={l} onClose={closeDialogs} onSave={onEdit} busy={busy} error={error} />}
    </>
  );
}

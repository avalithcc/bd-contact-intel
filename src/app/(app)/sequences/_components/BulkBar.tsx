"use client";

import { useId } from "react";
import { Dialog } from "@/components/Dialog";
import { SendSplitButton } from "@/components/send/SendSplitButton";
import { fillTemplate } from "@/lib/i18n/template";
import type { SendRecipient } from "@/lib/sendSchedule/advice";
import type { GenerationLock } from "@/lib/sequences/generationLock";
import { capOutlook } from "@/lib/sequences/sendMoment";
import type { GateRow } from "@/lib/sequences/bulkApprovalGate";
import { bulkBarView } from "@/lib/sequences/bulkBar";
import { fillStrong } from "@/lib/sequences/fillStrong";
import { nameList } from "@/lib/sequences/detailFlow";
import { fill, type SequenceLabels } from "@/lib/sequences/viewText";
import type { OnBulkAction } from "./actions";
import { approvalSchedule, cadenceHint, type SequenceSendContext } from "./sendContext";

/**
 * `selection` is every selected row with its reviewed flag: the counter and the gate are computed from it, nothing else.
 * "Aprobar y enviar ahora los N" is the shared split button (one choice for all N); before the BD confirms, a warning says how many
 * leave now and how many wait because of the account's daily cap. `mismatched` is every draft on the page in another language than today's (id -> name): the selected ones block the bulk, the others were left out of the selection, and the bar names both.
 */
export function BulkBar({ selection, labels: l, onAction, send, recipients, cap, now, lock, mismatched }: { selection: readonly GateRow[]; labels: SequenceLabels; onAction: OnBulkAction; send: SequenceSendContext; recipients: readonly SendRecipient[]; cap: { cap: number; sentToday: number }; now: Date; lock: GenerationLock; mismatched: Readonly<Record<string, string>> }) {
  const v = bulkBarView(selection);
  if (!v.visible) return null;
  const one = v.selected === 1;
  const unopened = v.selected - v.reviewed;
  const missing = fill(unopened === 1 ? l.bulkMissingOne : l.bulkMissing, { n: unopened });
  const wl = l.languageMismatch;
  const more = (n: number) => fill(l.bulkRefusedMore, { n });
  const blockedNames = v.ids.filter((id) => id in mismatched).map((id) => mismatched[id]!);
  const leftOutNames = Object.keys(mismatched).filter((id) => !v.ids.includes(id)).map((id) => mismatched[id]!);
  // The bold phrase ("1 de los seleccionados está en otro idioma") is a placeholder of the sentence; the plain text feeds the button's title.
  const note = (template: string, what: string, names: string[], n: number) => ({ plain: fill(template, { what: fill(what, { n }), names: nameList(names, more) }), rich: fillStrong(template, { what: fill(what, { n }), names: nameList(names, more) }, ["what"]) });
  const blocked = v.wrongLanguage === 0 ? null : note(v.wrongLanguage === 1 ? wl.barBlocked : wl.barBlockedMany, v.wrongLanguage === 1 ? wl.barBlockedWhat : wl.barBlockedWhatMany, blockedNames, v.wrongLanguage);
  const leftOut = leftOutNames.length === 0 ? null : note(leftOutNames.length === 1 ? wl.barLeftOut : wl.barLeftOutMany, leftOutNames.length === 1 ? wl.barLeftOutWhat : wl.barLeftOutWhatMany, leftOutNames, leftOutNames.length);
  const blockedLanguage = blocked?.plain ?? null;
  const gateTitle = blockedLanguage ?? `${missing} ${l.bulkMissingPending}`;
  const n = { n: v.selected };
  const outlook = capOutlook({ count: v.selected, cap: cap.cap, sentToday: cap.sentToday });
  return (
    <>
      <div className="bulk-bar" role="region" aria-label={v.wrongLanguage > 0 ? wl.barAria : v.allReviewed ? l.bulkAriaAll : l.bulkAriaPartial}>
        <span className="count">{fill(one ? l.bulkCountOne : l.bulkCount, n)}</span><span className="sep"></span>
        <span>{fill(v.allReviewed ? l.bulkReviewedAll : l.bulkReviewed, { reviewed: v.reviewed, total: v.selected })}</span>
        <span className="grow"></span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void onAction({ type: "remove", memberIds: v.ids })}>{l.bulkRemove}</button>
        <SendSplitButton
          small
          labels={send.labels}
          primaryLabel={fill(one ? l.bulkApproveNowOne : l.bulkApproveNow, n)}
          disabled={!v.approveEnabled || lock.bulkApproveDisabled}
          title={lock.bulkApproveDisabled ? l.generateBulkWaitTitle : !v.approveEnabled ? gateTitle : undefined}
          busy={send.busy}
          error={send.error}
          schedule={approvalSchedule(send, recipients, "bulk", v.selected)}
          cadence={{ hint: cadenceHint(now, send.schedule, l), onPick: () => onAction({ type: "approve", memberIds: v.ids, when: { kind: "cadence" } }) }}
          onSendNow={() => onAction({ type: "approve", memberIds: v.ids, when: { kind: "now" } })}
          onSchedule={(slot) => onAction({ type: "approve", memberIds: v.ids, when: { kind: "at", ...slot } })}
        />
        {/* Inside the sticky bar so the reason travels with the disabled button instead of being scrolled away. */}
        {unopened > 0 && <p className="note"><strong>{missing}</strong> {l.bulkMissingPending}. {l.bulkBlockedWhy}</p>}
        {blocked && <p className="note">{blocked.rich} {l.bulkBlockedWhy}</p>}
        {leftOut && <p className="note">{leftOut.rich}</p>}
      </div>
      {v.approveEnabled && outlook.deferred > 0 && (
        <div className="alert alert-warn mt-md" role="status">
          <div>
            <strong>{fillTemplate(send.labels.capBulk, { cap: String(cap.cap), n: String(v.selected), now: String(outlook.now), deferred: String(outlook.deferred) })}</strong>
          </div>
        </div>
      )}
    </>
  );
}

/** One reason for all the selected members. Controlled by the container, which closes it on success and keeps it open on failure. */
export function RemoveReasonDialog({ open, count, labels: l, onClose, onConfirm, busy = false, error = null }: { open: boolean; count: number; labels: SequenceLabels; onClose: () => void; onConfirm: (reason: string) => void; busy?: boolean; error?: string | null }) {
  const id = useId();
  return (
    <Dialog open={open} onClose={onClose} title={l.bulkRemove} closeDisabled={busy}
      footer={<><button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{l.bulkRemoveCancel}</button><button type="submit" form={id} className="btn btn-primary" disabled={busy}>{l.bulkRemoveConfirm}</button></>}>
      <form id={id} className="stack" onSubmit={(e) => { e.preventDefault(); const reason = String(new FormData(e.currentTarget).get("reason") ?? "").trim(); if (reason) onConfirm(reason); }}>
        <p>{fill(count === 1 ? l.bulkRemoveBodyOne : l.bulkRemoveBody, { n: count })}</p>
        <div className="field"><label className="label" htmlFor={`${id}-reason`}>{l.bulkRemoveReason}</label><input className="input" id={`${id}-reason`} name="reason" type="text" required /></div>
        {error && <span className="error-text" role="alert">{error}</span>}
      </form>
    </Dialog>
  );
}

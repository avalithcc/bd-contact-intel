"use client";

import { useId } from "react";
import { Dialog } from "@/components/Dialog";
import type { GateRow } from "@/lib/sequences/bulkApprovalGate";
import { bulkBarView } from "@/lib/sequences/bulkBar";
import { fill, type SequenceLabels } from "@/lib/sequences/viewText";
import type { OnBulkAction } from "./actions";

/** `selection` is every selected row with its reviewed flag: the counter and the gate are computed from it, nothing else. */
export function BulkBar({ selection, labels: l, onAction }: { selection: readonly GateRow[]; labels: SequenceLabels; onAction: OnBulkAction }) {
  const v = bulkBarView(selection);
  if (!v.visible) return null;
  const one = v.selected === 1;
  const n = { n: v.selected };
  const run = (type: "regenerate" | "approve" | "remove") => () => onAction({ type, memberIds: v.ids });
  return (
    <>
      <div className="bulk-bar" role="region" aria-label={v.allReviewed ? l.bulkAriaAll : l.bulkAriaPartial}>
        <span className="count">{fill(one ? l.bulkCountOne : l.bulkCount, n)}</span><span className="sep"></span>
        <span>{fill(v.allReviewed ? l.bulkReviewedAll : l.bulkReviewed, { reviewed: v.reviewed, total: v.selected })}</span>
        <span className="grow"></span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={run("regenerate")}>{fill(one ? l.bulkRegenerateOne : l.bulkRegenerate, n)}</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={run("remove")}>{l.bulkRemove}</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={!v.approveEnabled} onClick={run("approve")}>{fill(one ? l.bulkApproveOne : l.bulkApprove, n)}</button>
      </div>
      {!v.approveEnabled && <p className="help mt-md">{fill(one ? l.bulkBlockedOne : l.bulkBlocked, n)}</p>}
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

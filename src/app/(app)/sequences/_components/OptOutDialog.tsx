"use client";

import { Dialog } from "@/components/Dialog";
import { fill, type SequenceLabels } from "@/lib/sequences/viewText";

/**
 * The confirmation for "No contactar". It states the scope BEFORE the BD confirms, because the action reaches further
 * than the screen it starts from: the address is suppressed and every live membership of it is discarded, in every
 * Sequence and for every BD. `ownLiveCount` is only the part this viewer can count, so the copy never presents it as the
 * whole. Controlled by the container, which calls recordOptOutForMember on `onConfirm`, closes the dialog on success and
 * keeps it open with `error` on failure (see RemoveReasonDialog).
 */
export function OptOutDialog({ open, email, ownLiveCount, labels: l, onClose, onConfirm, busy = false, error = null }: { open: boolean; email: string | null; ownLiveCount: number; labels: SequenceLabels; onClose: () => void; onConfirm: () => void; busy?: boolean; error?: string | null }) {
  const own = ownLiveCount === 0 ? l.optOutOwnLiveNone : fill(ownLiveCount === 1 ? l.optOutOwnLiveOne : l.optOutOwnLive, { n: ownLiveCount });
  return (
    <Dialog open={open} onClose={onClose} title={l.optOutTitle} closeDisabled={busy}
      footer={<><button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{l.optOutCancel}</button><button type="button" className="btn btn-danger-solid" onClick={onConfirm} disabled={busy}>{l.optOutConfirm}</button></>}>
      <div className="stack">
        <p>{email ? fill(l.optOutLead, { email }) : l.optOutLeadNoEmail}</p>
        <div className="alert alert-warn"><div><span className="title">{l.optOutScope}</span></div></div>
        <ul className="stack-sm"><li>{own}</li><li>{l.optOutReplied}</li></ul>
        <p className="help">{l.optOutIrreversible}</p>
        {error && <span className="error-text" role="alert">{error}</span>}
      </div>
    </Dialog>
  );
}

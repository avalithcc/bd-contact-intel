"use client";

import { useId, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { DAILY_SEND_CAP_CEILING } from "@/lib/sequences/capValidation";
import { capState } from "@/lib/sequences/createForm";
import { fill, type SequenceLabels } from "@/lib/sequences/viewText";

/**
 * "Editar secuencia": the name and the daily cap, the two settings updateSequenceSettings changes. The mockup links the
 * button and draws no dialog, so this reuses the create form's fields, copy and validation (capState is the same rule
 * the server re-applies) and adds nothing else. Controlled by the container, which closes it on success and keeps it
 * open with `error` on failure.
 */
export function EditSequenceDialog({ open, name, cap, labels: l, onClose, onSave, busy = false, error = null }: { open: boolean; name: string; cap: number; labels: SequenceLabels; onClose: () => void; onSave: (patch: { name: string; dailySendCap: number }) => void; busy?: boolean; error?: string | null }) {
  const id = useId();
  const [draftName, setDraftName] = useState(name);
  const [draftCap, setDraftCap] = useState(String(cap));
  const [attempted, setAttempted] = useState(false);
  const capView = capState(draftCap);
  const nameMissing = draftName.trim() === "";
  return (
    <Dialog open={open} onClose={onClose} title={l.editTitle} closeDisabled={busy}
      footer={<><button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{l.editCancel}</button><button type="submit" form={id} className="btn btn-primary" disabled={busy}>{l.editSave}</button></>}>
      <form id={id} className="stack" noValidate onSubmit={(e) => { e.preventDefault(); setAttempted(true); if (!nameMissing && capView.error === null) onSave({ name: draftName.trim(), dailySendCap: capView.value as number }); }}>
        <div className="field">
          <label className="label" htmlFor={`${id}-name`}>{l.newName}</label>
          <input className={`input${attempted && nameMissing ? " is-invalid" : ""}`} id={`${id}-name`} value={draftName} onChange={(e) => setDraftName(e.target.value)} required aria-invalid={attempted && nameMissing} />
          {attempted && nameMissing && <span className="error-text">{l.newNameError}</span>}
        </div>
        <div className="field">
          <label className="label" htmlFor={`${id}-cap`}>{l.newCap}</label>
          <input className={`input${capView.error ? " is-invalid" : ""}`} id={`${id}-cap`} type="number" min={1} max={DAILY_SEND_CAP_CEILING} step={1} value={draftCap} onChange={(e) => setDraftCap(e.target.value)} aria-invalid={capView.error !== null} />
          {capView.error && <span className="error-text">{fill(capView.error === "ceiling" ? l.newCapCeiling : l.newCapInvalid, { max: DAILY_SEND_CAP_CEILING })}</span>}
        </div>
        {error && <span className="error-text" role="alert">{error}</span>}
      </form>
    </Dialog>
  );
}

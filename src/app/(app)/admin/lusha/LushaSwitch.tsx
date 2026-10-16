"use client";

// The per-BD switch, drawn as a `label.check` (the approved stylesheet has no switch component). Turning Lusha ON asks for
// confirmation because it unlocks real spend; turning it OFF applies at once. The server decides everything: this only calls the action.

import { useState, useTransition } from "react";
import { Dialog } from "@/components/Dialog";
import { InfoIcon } from "@/components/icons";
import { useToast } from "@/components/ToastProvider";
import { setLushaEnabledAction } from "./actions";

export interface SwitchLabels {
  enabled: string;
  disabled: string;
  ariaEnabled: string;
  ariaDisabled: string;
  dialogTitle: string;
  dialogBody: string;
  dialogLimitTitle: string;
  dialogLimitBody: string;
  dialogRecorded: string;
  dialogConfirm: string;
  cancel: string;
  toastEnabled: string;
  toastDisabled: string;
  errorSave: string;
}

export function LushaSwitch({ bdId, name, enabled, labels: l }: { bdId: string; name: string; enabled: boolean; labels: SwitchLabels }) {
  const { showToast } = useToast();
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();

  function apply(next: boolean) {
    start(async () => {
      let ok = false;
      try {
        ok = (await setLushaEnabledAction(bdId, next)).ok;
      } catch {
        ok = false;
      }
      setAsking(false);
      if (ok) showToast(next ? l.toastEnabled : l.toastDisabled);
      else showToast(l.errorSave, "error");
    });
  }

  return (
    <>
      <label className="check">
        <input type="checkbox" checked={enabled} disabled={pending} aria-label={enabled ? l.ariaEnabled : l.ariaDisabled} onChange={() => (enabled ? apply(false) : setAsking(true))} /> {enabled ? l.enabled : l.disabled}
      </label>
      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        closeDisabled={pending}
        title={l.dialogTitle}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setAsking(false)} disabled={pending}>
              {l.cancel}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => apply(true)} disabled={pending}>
              {l.dialogConfirm}
            </button>
          </>
        }
      >
        <p>{l.dialogBody}</p>
        <div className="alert alert-info" role="note">
          <InfoIcon className="icon" />
          <div>
            <div className="title">{l.dialogLimitTitle}</div>
            {l.dialogLimitBody}
          </div>
        </div>
        <p className="meta">{l.dialogRecorded}</p>
      </Dialog>
    </>
  );
}

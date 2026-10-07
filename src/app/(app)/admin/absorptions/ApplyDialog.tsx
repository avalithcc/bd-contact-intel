"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { CheckIcon } from "@/components/icons";
import { confirmationMatches } from "@/lib/companies/absorptionReview";

export interface ApplyDialogLabels {
  open: string;
  title: string;
  body: string;
  confirm: string;
  audit: string;
  cancel: string;
}

/**
 * The typed-name brake before an irreversible merge (mockup's "Aplicar la fusión" dialog). The disabled button is a
 * convenience only: the action re-reads the proposal and re-checks the name on the server. The dialog closes once the
 * action settles, whatever the outcome, because the page shows the result (success, refusal or blockers) in an alert
 * that the overlay would otherwise hide.
 */
export function ApplyDialog({
  proposalId,
  expectedName,
  labels,
  action,
}: {
  proposalId: string;
  expectedName: string;
  labels: ApplyDialogLabels;
  action: (formData: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const formId = `apply-${useId()}`;
  const inputId = `${formId}-name`;
  const [, run, pending] = useActionState(async (_prev: null, formData: FormData) => {
    await action(formData);
    return null;
  }, null);
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending) {
      setOpen(false);
      setTyped("");
    }
    wasPending.current = pending;
  }, [pending]);

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        <CheckIcon className="icon" />
        {labels.open}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={labels.title}
        closeDisabled={pending}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={pending}>
              {labels.cancel}
            </button>
            <button type="submit" form={formId} className="btn btn-primary" disabled={pending || !confirmationMatches(typed, expectedName)}>
              {labels.open}
            </button>
          </>
        }
      >
        <form id={formId} action={run} className="stack">
          <input type="hidden" name="proposalId" value={proposalId} />
          <p>{labels.body}</p>
          <div className="field">
            <label className="label" htmlFor={inputId}>
              {labels.confirm}
            </label>
            <input
              id={inputId}
              type="text"
              name="confirmName"
              className="input"
              placeholder={expectedName}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
            />
          </div>
          <p className="meta">{labels.audit}</p>
        </form>
      </Dialog>
    </>
  );
}

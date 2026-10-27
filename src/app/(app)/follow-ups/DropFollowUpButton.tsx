"use client";

import { useId, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { FollowUpIcon, InfoIcon } from "@/components/icons";
import { useToast } from "@/components/ToastProvider";
import { FOLLOW_UP_DROP_REASONS, type FollowUpDropReason } from "@/lib/followUp/cycle";
import { fillTemplate } from "@/lib/i18n/template";
import { dropFollowUpAction } from "./actions";

export interface DropFollowUpLabels {
  button: string;
  staysTitle: string;
  staysBody: string;
  reasonLabel: string;
  reasonPlaceholder: string;
  detailRequiredLabel: string;
  detailOptionalLabel: string;
  detailError: string;
  cancel: string;
  error: string;
  /** One label per reason code, in the dialog's select. */
  reasons: Record<FollowUpDropReason, string>;
}

/**
 * "Dar de baja del seguimiento" (follow-up-expiry mockup seguimientos-vencidos.html): the button that takes the "Posponer" slot on a
 * Vencido card, and its dialog (the shipped discard dialog's structure). The reason is required; the detail is optional except for
 * «Otro», where it turns required and invalid until filled. The server action re-validates the same rule.
 */
export function DropFollowUpButton({
  itemId,
  name,
  contactLine,
  statusLabel,
  labels: l,
}: {
  itemId: string;
  name: string;
  /** Pre-composed server-side: "CTO en Rappi · Contactado · último toque hace 12 d · en la cola desde 20 oct". */
  contactLine: string;
  statusLabel: string;
  labels: DropFollowUpLabels;
}) {
  const ids = useId();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const detailRequired = reason === "other";
  const detailInvalid = detailRequired && detail.trim() === "";

  function close() {
    if (busy) return;
    setOpen(false);
    setReason("");
    setDetail("");
  }

  async function submit() {
    setBusy(true);
    try {
      const result = await dropFollowUpAction(itemId, reason, detail);
      if (!result.ok) showToast(l.error, "error");
      else {
        setOpen(false);
        setReason("");
        setDetail("");
      }
    } catch {
      showToast(l.error, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <FollowUpIcon className="icon" />
        {l.button}
      </button>
      <Dialog
        open={open}
        onClose={close}
        closeDisabled={busy}
        title={l.button}
        icon={<FollowUpIcon className="icon" />}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={close} disabled={busy}>
              {l.cancel}
            </button>
            <button type="button" className="btn btn-primary" disabled={busy || !reason || detailInvalid} onClick={submit}>
              {l.button}
            </button>
          </>
        }
      >
        <div>
          <strong>{name}</strong>
          <div className="meta">{contactLine}</div>
        </div>
        <div className="alert alert-info" role="note">
          <InfoIcon className="icon" />
          <div>
            <span className="title">{l.staysTitle}</span> {fillTemplate(l.staysBody, { status: statusLabel })}
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor={`${ids}-reason`}>
            {l.reasonLabel}
          </label>
          <select id={`${ids}-reason`} className="select input" value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy}>
            <option value="">{l.reasonPlaceholder}</option>
            {FOLLOW_UP_DROP_REASONS.map((code) => (
              <option key={code} value={code}>
                {l.reasons[code]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor={`${ids}-detail`}>
            {detailRequired ? l.detailRequiredLabel : l.detailOptionalLabel}
          </label>
          <textarea
            id={`${ids}-detail`}
            className={`textarea input${detailInvalid ? " is-invalid" : ""}`}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            disabled={busy}
            aria-describedby={detailInvalid ? `${ids}-detail-err` : undefined}
          />
          {detailInvalid && (
            <span className="error-text" id={`${ids}-detail-err`}>
              {l.detailError}
            </span>
          )}
        </div>
      </Dialog>
    </>
  );
}

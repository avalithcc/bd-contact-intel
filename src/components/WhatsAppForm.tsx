"use client";

import { useId, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { WHATSAPP_OUTCOME_CODES, type WhatsAppOutcomeCode } from "@/lib/contacts/whatsapp";
import type { ContactRecordLabels } from "@/lib/contacts/labels";

const WHATSAPP_OUTCOME_LABEL_KEY = {
  sent: "whatsappOutcomeSent",
  replied: "whatsappOutcomeReplied",
  no_whatsapp: "whatsappOutcomeNoWhatsapp",
} as const satisfies Record<WhatsAppOutcomeCode, keyof ContactRecordLabels>;

export interface WhatsAppFormValues {
  outcome: string;
  date: string;
  time: string;
  notes: string;
}

/**
 * "WhatsApp" quick action on the record (whatsapp-como-actividad): outcome, date/time, notes. Mirrors CallForm without
 * a direction control (the outcome says who wrote) and without the dial-bar extras.
 */
export function WhatsAppForm({
  labels: l,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  labels: ContactRecordLabels;
  busy: boolean;
  /** Already rendered by the caller (message, optional link). */
  error?: React.ReactNode;
  onCancel: () => void;
  onSubmit: (values: WhatsAppFormValues) => void;
}) {
  const ids = useId();
  const [outcome, setOutcome] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");

  // Client-side "no future entry" guard — mirrors planWhatsApp's server-side check (src/lib/contacts/whatsapp.ts), which is
  // the source of truth; this only keeps the pickers from offering an obviously-rejected value.
  const now = new Date();
  const dateMax = now.toISOString().slice(0, 10);
  const timeMax = date === "" || date === dateMax ? now.toTimeString().slice(0, 5) : undefined;

  return (
    <Dialog
      open
      onClose={onCancel}
      closeDisabled={busy}
      title={l.whatsappSubmit}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            {l.cancel}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !outcome}
            onClick={() => outcome && onSubmit({ outcome, date, time, notes })}
          >
            {l.whatsappSubmit}
          </button>
        </>
      }
    >
      {error}
      <div className="field">
        <label className="label" htmlFor={`${ids}-outcome`}>
          {l.whatsappOutcomeLabel}
        </label>
        <select id={`${ids}-outcome`} className="select" value={outcome} onChange={(e) => setOutcome(e.target.value)} disabled={busy}>
          <option value="">{l.whatsappOutcomePlaceholder}</option>
          {WHATSAPP_OUTCOME_CODES.map((code) => (
            <option key={code} value={code}>
              {l[WHATSAPP_OUTCOME_LABEL_KEY[code]]}
            </option>
          ))}
        </select>
      </div>
      <div className="form-grid">
        <div className="field">
          <label className="label" htmlFor={`${ids}-date`}>
            {l.callDateLabel}
          </label>
          <input id={`${ids}-date`} className="input" type="date" value={date} max={dateMax} onChange={(e) => setDate(e.target.value)} disabled={busy} />
        </div>
        <div className="field">
          <label className="label" htmlFor={`${ids}-time`}>
            {l.callTimeLabel}
          </label>
          <input id={`${ids}-time`} className="input" type="time" value={time} max={timeMax} onChange={(e) => setTime(e.target.value)} disabled={busy} />
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor={`${ids}-notes`}>
          {l.callNotesLabel}
        </label>
        <textarea id={`${ids}-notes`} className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} />
      </div>
      <p className="help">{l.whatsappHelp}</p>
    </Dialog>
  );
}

"use client";

import { useId, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { CallIcon } from "@/components/icons";
import { CALL_OUTCOME_CODES, type CallOutcomeCode } from "@/lib/contacts/call";
import type { ContactRecordLabels } from "@/lib/contacts/labels";

const CALL_OUTCOME_LABEL_KEY = {
  connected: "callOutcomeConnected",
  busy: "callOutcomeBusy",
  no_answer: "callOutcomeNoAnswer",
  voicemail: "callOutcomeVoicemail",
  wrong_number: "callOutcomeWrongNumber",
} as const satisfies Record<CallOutcomeCode, keyof ContactRecordLabels>;

/** The strings CallForm needs. Narrow on purpose: the app shell mounts the dialog, so it must not carry the whole record dictionary. */
export type CallFormLabels = Pick<
  ContactRecordLabels,
  | "callSubmit"
  | "cancel"
  | "callOutcomeLabel"
  | "callOutcomePlaceholder"
  | "callOutcomeConnected"
  | "callOutcomeBusy"
  | "callOutcomeNoAnswer"
  | "callOutcomeVoicemail"
  | "callOutcomeWrongNumber"
  | "callDateLabel"
  | "callTimeLabel"
  | "callNotesLabel"
  | "callHelp"
  | "errorCallOccurredAtInFuture"
>;

export function pickCallFormLabels(l: CallFormLabels): CallFormLabels {
  return {
    callSubmit: l.callSubmit,
    cancel: l.cancel,
    callOutcomeLabel: l.callOutcomeLabel,
    callOutcomePlaceholder: l.callOutcomePlaceholder,
    callOutcomeConnected: l.callOutcomeConnected,
    callOutcomeBusy: l.callOutcomeBusy,
    callOutcomeNoAnswer: l.callOutcomeNoAnswer,
    callOutcomeVoicemail: l.callOutcomeVoicemail,
    callOutcomeWrongNumber: l.callOutcomeWrongNumber,
    callDateLabel: l.callDateLabel,
    callTimeLabel: l.callTimeLabel,
    callNotesLabel: l.callNotesLabel,
    callHelp: l.callHelp,
    errorCallOccurredAtInFuture: l.errorCallOccurredAtInFuture,
  };
}

export interface CallFormValues {
  outcome: string;
  date: string;
  time: string;
  notes: string;
  /** Present only when the follow-up box is ticked and has a title. */
  followUp: { title: string; dueDate: string } | null;
}

/** The "Más detalles…" extras (click-to-call-log mockup): who and which number was dialled, now-prefilled date/time, optional follow-up task. */
export interface CallFormDial {
  line: string;
  name: string;
  number: string;
  /** "Teléfono" / "Móvil": which stored number was dialled. */
  fieldLabel: string;
  date: string;
  time: string;
  followUp: { toggleLabel: string; titleLabel: string; dueLabel: string; title: string; dueDate: string };
}

/** "Registrar llamada": the quick action on the record, and "Más detalles…" on the outcome bar (with `dial`). */
export function CallForm({
  labels: l,
  busy,
  error,
  dial,
  onCancel,
  onSubmit,
}: {
  labels: CallFormLabels;
  busy: boolean;
  /** Already rendered by the caller (message, optional link). */
  error?: React.ReactNode;
  dial?: CallFormDial;
  onCancel: () => void;
  onSubmit: (values: CallFormValues) => void;
}) {
  const ids = useId();
  const [outcome, setOutcome] = useState("");
  const [date, setDate] = useState(dial?.date ?? "");
  const [time, setTime] = useState(dial?.time ?? "");
  const [notes, setNotes] = useState("");
  const [followUpOn, setFollowUpOn] = useState(Boolean(dial));
  const [followTitle, setFollowTitle] = useState(dial?.followUp.title ?? "");
  const [followDue, setFollowDue] = useState(dial?.followUp.dueDate ?? "");

  // Client-side "no future call" guard — mirrors planCall's server-side check
  // (src/lib/contacts/call.ts), which is the source of truth; this only keeps
  // the pickers from offering an obviously-rejected value. The dialog's own
  // dates are Argentina wall-clock, so it skips the browser-clock time cap.
  const now = new Date();
  const dateMax = dial?.date ?? now.toISOString().slice(0, 10);
  const timeMax = !dial && (date === "" || date === dateMax) ? now.toTimeString().slice(0, 5) : undefined;
  const followUpInvalid = followUpOn && dial && !followTitle.trim();

  return (
    <Dialog
      open
      onClose={onCancel}
      closeDisabled={busy}
      title={l.callSubmit}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            {l.cancel}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !outcome || Boolean(followUpInvalid)}
            onClick={() =>
              outcome &&
              onSubmit({
                outcome,
                date,
                time,
                notes,
                followUp: dial && followUpOn ? { title: followTitle.trim(), dueDate: followDue } : null,
              })
            }
          >
            {l.callSubmit}
          </button>
        </>
      }
    >
      {error}
      {dial && (
        <div className="dial-line">
          <CallIcon className="icon" />
          <span>
            {dial.line} <strong>{dial.name}</strong> · <span className="mono">{dial.number}</span>
          </span>
          <span className="meta">{dial.fieldLabel}</span>
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor={`${ids}-outcome`}>
          {l.callOutcomeLabel}
        </label>
        <select id={`${ids}-outcome`} className="select" value={outcome} onChange={(e) => setOutcome(e.target.value)} disabled={busy}>
          <option value="">{l.callOutcomePlaceholder}</option>
          {CALL_OUTCOME_CODES.map((code) => (
            <option key={code} value={code}>
              {l[CALL_OUTCOME_LABEL_KEY[code]]}
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
      {dial && (
        <div>
          <div className="check">
            <input id={`${ids}-follow`} type="checkbox" checked={followUpOn} onChange={(e) => setFollowUpOn(e.target.checked)} disabled={busy} />
            <label htmlFor={`${ids}-follow`}>{dial.followUp.toggleLabel}</label>
          </div>
          {followUpOn && (
            <div className="followup">
              <div className="field">
                <label className="label" htmlFor={`${ids}-ftitle`}>
                  {dial.followUp.titleLabel}
                </label>
                <input id={`${ids}-ftitle`} className="input" value={followTitle} onChange={(e) => setFollowTitle(e.target.value)} disabled={busy} />
              </div>
              <div className="field">
                <label className="label" htmlFor={`${ids}-fdue`}>
                  {dial.followUp.dueLabel}
                </label>
                <input id={`${ids}-fdue`} className="input" type="date" value={followDue} onChange={(e) => setFollowDue(e.target.value)} disabled={busy} />
              </div>
            </div>
          )}
        </div>
      )}
      <p className="help">{l.callHelp}</p>
    </Dialog>
  );
}

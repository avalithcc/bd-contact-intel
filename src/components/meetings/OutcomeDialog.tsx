"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/Dialog";
import { MeetingIcon } from "@/components/icons";
import { useToast } from "@/components/ToastProvider";
import { confirmMeetingOutcomeAction, undoMeetingOutcomeAction } from "@/app/(app)/reuniones/actions";
import { fillTemplate } from "@/lib/i18n/template";
import { meetingErrorMessage, type MeetingLabels } from "@/lib/meetings/labels";
import { availableOutcomes, defaultFollowUpDueDate } from "@/lib/meetings/outcome";
import { OUTCOME_CHOICES, type OutcomeChoice } from "@/lib/meetings/status";
import { argentinaWallClockToUtc } from "@/lib/tasks/argentinaDate";

export interface OutcomeDialogMeeting {
  id: string;
  contactName: string;
  company: string | null;
  /** ISO instant the meeting is scheduled for. */
  scheduledAtIso: string;
  /** The same instant already formatted for display (computed on the server, so server and client agree). */
  whenText: string;
  notes: string | null;
}

/** Which button opened the dialog: "Confirmar" (nothing chosen), "Reprogramar" or "Cancelar" (that option preselected). */
export type OutcomeEntry = "confirm" | "reschedule" | "cancel";

const PRESELECTED: Record<OutcomeEntry, OutcomeChoice | null> = { confirm: null, reschedule: "rescheduled", cancel: "cancelled" };

const OPTION_COPY: Record<OutcomeChoice, { title: keyof MeetingLabels; desc: keyof MeetingLabels }> = {
  held: { title: "optHeld", desc: "optHeldDesc" },
  no_show: { title: "optNoShow", desc: "optNoShowDesc" },
  rescheduled: { title: "optRescheduled", desc: "optRescheduledDesc" },
  cancelled: { title: "optCancelled", desc: "optCancelledDesc" },
};

/**
 * The "¿Cómo fue la reunión?" dialog (meetings mockup 3d/3f), shared by the Reuniones page and the contact record. One
 * component for all four outcomes; the entry point only decides the title and which option starts selected. It stays open with
 * the error when the save fails, closes on success, and offers "Deshacer" in the toast.
 */
export function OutcomeDialog({
  meeting,
  entry,
  labels: l,
  onClose,
}: {
  meeting: OutcomeDialogMeeting;
  entry: OutcomeEntry;
  labels: MeetingLabels;
  onClose: () => void;
}) {
  const ids = useId();
  const router = useRouter();
  const { showToast } = useToast();
  const openedAt = useMemo(() => new Date(), []);
  const enabled = availableOutcomes({ status: "scheduled", scheduledAt: new Date(meeting.scheduledAtIso) }, openedAt);

  const [outcome, setOutcome] = useState<OutcomeChoice | null>(PRESELECTED[entry]);
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [followUp, setFollowUp] = useState(true);
  const [followUpDue, setFollowUpDue] = useState(() => defaultFollowUpDueDate(openedAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const newInstant = newDate && newTime ? argentinaWallClockToUtc(newDate, newTime) : null;
  const newInPast = newInstant !== null && newInstant.getTime() <= Date.now();
  const hasFollowUp = outcome === "no_show" || outcome === "cancelled";
  const valid =
    outcome !== null &&
    enabled[outcome] &&
    (outcome !== "rescheduled" || (newInstant !== null && !newInPast)) &&
    (!hasFollowUp || !followUp || followUpDue !== "");

  const title = fillTemplate(
    entry === "reschedule" ? l.dialogTitleReschedule : entry === "cancel" ? l.dialogTitleCancel : l.dialogTitleHow,
    { name: meeting.contactName },
  );
  // The button names the action ("Reprogramar", "Cancelar reunión") when that is what will happen; otherwise it is "Guardar".
  const submitLabel = busy
    ? l.saving
    : outcome === "rescheduled"
      ? l.saveReschedule
      : outcome === "cancelled" && entry === "cancel"
        ? l.saveCancel
        : l.save;

  async function submit() {
    if (!valid || outcome === null || busy) return;
    setBusy(true);
    setError(null);
    const result = await confirmMeetingOutcomeAction(meeting.id, {
      outcome,
      notes,
      reason,
      newDate,
      newTime,
      followUp: hasFollowUp && followUp,
      followUpDueDate: followUpDue,
    }).catch(() => ({ ok: false as const, reason: "unexpected" as const }));
    setBusy(false);
    if (!result.ok) {
      setError(meetingErrorMessage(l, result.reason));
      return;
    }
    onClose();
    router.refresh();
    showToast(l.toastConfirmed, "success", {
      actionLabel: l.toastUndo,
      onAction: async () => {
        const undone = await undoMeetingOutcomeAction(meeting.id).catch(() => ({ ok: false as const, reason: "unexpected" as const }));
        if (undone.ok) {
          showToast(l.toastUndone);
          router.refresh();
        } else {
          showToast(meetingErrorMessage(l, undone.reason), "error");
        }
      },
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      closeDisabled={busy}
      title={title}
      icon={<MeetingIcon className="icon" />}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {l.dismiss}
          </button>
          <button type="button" className="btn btn-primary" disabled={!valid || busy} onClick={submit}>
            {submitLabel}
          </button>
        </>
      }
    >
      <div className="stack">
        {error && (
          <div className="alert alert-danger" role="alert">
            <div>{error}</div>
          </div>
        )}
        <dl className="summary">
          <div>
            <dt>{l.summaryContact}</dt>
            <dd>{meeting.contactName}</dd>
          </div>
          <div>
            <dt>{l.summaryCompany}</dt>
            <dd>{meeting.company ?? l.summaryEmpty}</dd>
          </div>
          <div>
            <dt>{l.summaryWhen}</dt>
            <dd>{meeting.whenText}</dd>
          </div>
          <div className="wide">
            <dt>{l.summaryNotes}</dt>
            <dd>{meeting.notes ?? l.summaryEmpty}</dd>
          </div>
        </dl>

        <fieldset className="fieldset">
          <legend className="label">{l.resultLegend}</legend>
          <div className="opts" role="radiogroup" aria-label={l.resultAria}>
            {OUTCOME_CHOICES.map((choice) => {
              const off = !enabled[choice];
              // The card is a div (a label may not wrap its control in a Dialog, see dialogMarkup.test.ts): the radio keeps
              // its own label, and a click anywhere on the card selects the option.
              return (
                <div
                  key={choice}
                  className={`opt${outcome === choice ? " sel" : ""}${off ? " off" : ""}`}
                  onClick={() => !off && !busy && setOutcome(choice)}
                >
                  <input
                    id={`${ids}-${choice}`}
                    type="radio"
                    name={`${ids}-outcome`}
                    value={choice}
                    checked={outcome === choice}
                    disabled={off || busy}
                    onChange={() => setOutcome(choice)}
                  />
                  <label htmlFor={`${ids}-${choice}`}>
                    <span className="opt-t">{l[OPTION_COPY[choice].title]}</span>
                    <span className="opt-d">{off ? l.optNotYet : l[OPTION_COPY[choice].desc]}</span>
                  </label>
                </div>
              );
            })}
          </div>
        </fieldset>

        {outcome === null && <p className="help">{l.chooseHelp}</p>}

        {outcome === "held" && (
          <div className="reveal">
            <div className="field">
              <label className="label" htmlFor={`${ids}-notes`}>
                {l.heldNotesLabel}
              </label>
              <textarea id={`${ids}-notes`} className="textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} />
            </div>
          </div>
        )}

        {outcome === "rescheduled" && (
          <div className="reveal stack">
            <div className="form-grid">
              <div className="field">
                <label className="label" htmlFor={`${ids}-new-date`}>
                  {l.newDateLabel}
                </label>
                <input id={`${ids}-new-date`} className="input" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} disabled={busy} />
              </div>
              <div className="field">
                <label className="label" htmlFor={`${ids}-new-time`}>
                  {l.newTimeLabel}
                </label>
                <input id={`${ids}-new-time`} className="input" type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} disabled={busy} />
              </div>
            </div>
            {newInPast ? <p className="help help-warn">{l.errNewTimeInPast}</p> : <p className="help">{l.rescheduleHelp}</p>}
          </div>
        )}

        {hasFollowUp && (
          <div className="reveal stack">
            <div className="field">
              <label className="label" htmlFor={`${ids}-reason`}>
                {l.reasonLabel}
              </label>
              <input
                id={`${ids}-reason`}
                className="input"
                type="text"
                placeholder={l.reasonPlaceholder}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="row">
              <div className="check-row">
                <input id={`${ids}-follow-up`} type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} disabled={busy} />
                <label htmlFor={`${ids}-follow-up`}>{l.followUpLabel}</label>
              </div>
              <span className="grow" />
              <label className="label" htmlFor={`${ids}-due`}>
                {l.followUpDueLabel}
              </label>
              <input
                id={`${ids}-due`}
                className="input input-sm"
                type="date"
                style={{ width: "auto" }}
                value={followUpDue}
                onChange={(e) => setFollowUpDue(e.target.value)}
                disabled={busy || !followUp}
              />
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

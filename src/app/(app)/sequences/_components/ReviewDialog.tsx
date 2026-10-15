"use client";

import { useEffect, useId, type FormEvent } from "react";
import { Dialog } from "@/components/Dialog";
import { GenerateIcon, InfoIcon } from "@/components/icons";
import type { DetailMember } from "@/lib/sequences/detailQueries";
import { reviewView, type ReviewFooterId } from "@/lib/sequences/reviewDialog";
import type { Schedule } from "@/lib/sequences/schedule";
import { agoText, fill, miamiWhen, type SequenceLabels } from "@/lib/sequences/viewText";
import type { OnReviewAction } from "./actions";

type Props = {
  open: boolean;
  onClose: () => void;
  member: DetailMember | null;
  step: 1 | 2;
  fromAddress: string;
  schedule: Schedule;
  /** The "Señales usadas" chips, already worded by the container from the generator input (never from model output). */
  signals: string[];
  now: Date;
  labels: SequenceLabels;
  /** The viewer owns the Sequence: only then may the notice say the email leaves under THEIR name. */
  ownView: boolean;
  onAction: OnReviewAction;
  busy?: boolean;
  error?: string | null;
};

export function ReviewDialog({ open, onClose, member: m, step, fromAddress, schedule, signals, now, labels: l, ownView, onAction, busy = false, error = null }: Props) {
  const formId = useId();
  const view = m ? reviewView(m, step, schedule, now) : null;
  const memberId = m?.memberId;
  const marks = open && view?.marksReviewed === true;
  // Opening is the review: report it once per open, never from a passive listing.
  useEffect(() => {
    if (marks && memberId) onAction({ type: "markReviewed", memberId, step });
    // The intent is per open; a new onAction identity must not re-report it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks, memberId, step]);
  if (!m || !view) return null;

  const name = [m.firstName, m.lastName].filter(Boolean).join(" ") || l.unnamed;
  const title = [name, [m.jobTitle?.trim() || l.noTitle, m.company && `${l.headlineAt} ${m.company}`].filter(Boolean).join(" ")].join(" · ");
  const when = (d: Date) => { const w = miamiWhen(d, now); return `${w.ddmm} ${w.hhmm}`; };
  // Null for a member stopped before anything was sent: there is no cadence to show (reviewDialog.ts kindOf).
  const { cadence } = view;
  const step1Lead = !cadence ? null : cadence.step1.kind === "sent" ? fill(l.emailSent, { ago: agoText(cadence.step1.at, now, l) }) : cadence.step1.kind === "scheduled" ? l.reviewReleases : l.reviewReleasesIfApproved;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (view?.readOnly || !memberId) return;
    const intent = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value");
    const data = new FormData(e.currentTarget);
    if (intent === "save" || intent === "approve") onAction({ type: intent, memberId, step, subject: String(data.get("subject") ?? ""), body: String(data.get("body") ?? "") });
  }
  const footerButton = (id: ReviewFooterId) =>
    id === "regenerate" ? (
      <button key={id} type="button" className="btn btn-ghost left" disabled={busy} onClick={() => onAction({ type: "regenerate", memberId: m.memberId, step })}><GenerateIcon className="icon" />{l.reviewRegenerate}</button>
    ) : (
      <button key={id} type="submit" form={formId} value={id} className={`btn ${id === "approve" ? "btn-primary" : "btn-secondary"}`} disabled={busy}>{id === "approve" ? l.reviewApprove : l.reviewSave}</button>
    );

  return (
    <Dialog open={open} onClose={onClose} title={title} wide closeDisabled={busy}
      footer={view.readOnly ? <button type="button" className="btn btn-secondary" onClick={onClose}>{l.reviewClose}</button> : view.footer.map(footerButton)}>
      <form id={formId} className="stack" onSubmit={submit} key={`${m.memberId}-${step}`}>
        <div className="alert alert-info">
          <InfoIcon className="icon" />
          <div>
            {view.kind === "sent" && l.reviewSentNotice}
            {view.kind === "stopped" && l.reviewStoppedNotice}
            {view.kind === "reminder" && fill(l.reviewReminderNotice, { date: miamiWhen(m.sentAt ?? now, now).ddmm })}
            {view.kind === "approved" && fill(l.reviewApprovedNotice, { ago: view.draft.approvedAt ? agoText(view.draft.approvedAt, now, l) : "" })}
            {(view.kind === "draft" || view.kind === "reminder") && <> {l.reviewNotice} <strong>{l.reviewNoticeStrong}</strong> {ownView ? l.reviewNoticeTail : l.reviewNoticeTailOther}</>}
          </div>
        </div>
        {!view.readOnly && (
          <div className="field"><span className="label">{l.reviewSignals}</span>
            {signals.length > 0 ? <div className="row wrap row-xs">{signals.map((s) => <span key={s} className="chip">{s}</span>)}</div> : <p className="help">{l.reviewSignalsNone}</p>}
            <p className="help">{l.reviewSignalsHelp}</p>
          </div>
        )}
        <div className="field"><label className="label" htmlFor={`${formId}-to`}>{l.reviewTo}</label>
          <input className="input" id={`${formId}-to`} type="text" value={m.email ?? l.reviewNoEmail} readOnly />
          <p className="help">{l.reviewFrom} <strong>{fromAddress}</strong> · {fill(l.reviewLogged, { name })}</p>
        </div>
        <div className="field"><label className="label" htmlFor={`${formId}-subject`}>{l.reviewSubject}</label>
          {/* `required` catches the empty case in the browser; saveDraftEdit still refuses a whitespace-only value,
              and the container surfaces that through `error`. A readOnly field is barred from validation, so the
              read-only variant is unaffected. */}
          <input className="input" id={`${formId}-subject`} name="subject" type="text" defaultValue={view.draft.subject} readOnly={view.readOnly} required />
        </div>
        <div className="field"><label className="label" htmlFor={`${formId}-body`}>{l.reviewBody}</label>
          <textarea className="textarea" id={`${formId}-body`} name="body" rows={11} defaultValue={view.draft.body} readOnly={view.readOnly} required />
          {!view.readOnly && <p className="help">{l.reviewBodyHelp}</p>}
          {/* Plain `help`: the mockup never drew this warning, so it has no approved emphasis style. Styling it is a
              PR 13 visual-review question; saying it at all is not optional. */}
          {view.kind === "approved" && <p className="help">{l.reviewApprovedEditWarning}</p>}
        </div>
        {cadence && (
          <div className="field"><span className="label">{l.reviewCadence}</span>
            <div className="assoc">
              <div className="assoc-row"><span className="badge badge-mono">{l.cadenceStep1}</span><span className="grow">{step1Lead}{cadence.step1.kind !== "sent" && <> <strong>{when(cadence.step1.at)}</strong> {l.reviewMiami}</>}</span></div>
              <div className="assoc-row"><span className="badge badge-mono">{l.cadenceStep2}</span><span className="grow">{l.reviewReminderOn} <strong>{miamiWhen(cadence.reminderAt, now).ddmm}</strong>{l.cadenceStep2Tail}</span></div>
            </div>
          </div>
        )}
        {error && <span className="error-text" role="alert">{error}</span>}
      </form>
    </Dialog>
  );
}

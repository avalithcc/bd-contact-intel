"use client";

import { useEffect, useId, useReducer, type FormEvent } from "react";
import { Dialog } from "@/components/Dialog";
import { EyeIcon, GenerateIcon, InfoIcon, WarningIcon } from "@/components/icons";
import { SendSplitButton } from "@/components/send/SendSplitButton";
import { resolveRecipientZone } from "@/lib/sendSchedule/zones";
import { memberDraftMismatch } from "@/lib/sequences/audienceCard";
import { draftVersion } from "@/lib/sequences/draftVersion";
import { INITIAL_RELOAD, reloadKey, reloadReducer } from "@/lib/sequences/reviewReload";
import type { SendChoice } from "@/lib/sequences/sendMoment";
import type { DetailMember } from "@/lib/sequences/detailQueries";
import { reviewView, type ReviewFooterId } from "@/lib/sequences/reviewDialog";
import type { Schedule } from "@/lib/sequences/schedule";
import { agoText, fill, miamiWhen, type SequenceLabels } from "@/lib/sequences/viewText";
import type { OnReviewAction } from "./actions";
import { LanguageMismatchAlert, languageWord } from "./LanguageMismatch";
import { approvalSchedule, cadenceHint, type SequenceSendContext } from "./sendContext";

type Props = {
  open: boolean;
  onClose: () => void;
  member: DetailMember | null;
  step: 1 | 2;
  fromAddress: string;
  schedule: Schedule;
  /** The "Señales usadas" chips, already worded by the container from the generator input (never from model output). Null when they cannot be known (an admin reading another BD's Sequence): the block is then left out, because "none registered" would be false. */
  signals: string[] | null;
  now: Date;
  labels: SequenceLabels;
  /** The viewer owns the Sequence: only then may the notice say the email leaves under THEIR name. */
  ownView: boolean;
  /** Another BD's Sequence: the neutral read-only notice replaces the editing notice and the only footer action is "Cerrar". */
  readOnly?: boolean;
  ownerName?: string;
  onAction: OnReviewAction;
  busy?: boolean;
  /** A draft is being generated elsewhere on the screen: a second generation would collide with it (generationLock.ts). */
  regenerateLocked?: boolean;
  error?: string | null;
  /** The server refused the review mark: the text shown here is not the stored one. The draft stays unreviewed. */
  stale?: boolean;
  /** The shared send control: labels, the cadence and the state of the last server call. */
  send: SequenceSendContext;
};

/** A reload whose refetch never answers frees the button after this long. */
const RELOAD_TIMEOUT_MS = 10_000;

export function ReviewDialog({ open, onClose, member: m, step, fromAddress, schedule, signals, now, labels: l, ownView, readOnly = false, ownerName = "", onAction, busy = false, regenerateLocked = false, error = null, stale = false, send }: Props) {
  const formId = useId();
  const view = m ? reviewView(m, step, schedule, now, readOnly) : null;
  const memberId = m?.memberId;
  const marks = open && view?.marksReviewed === true;
  const [reload, dispatch] = useReducer(reloadReducer, INITIAL_RELOAD);
  const { reads, pending } = reload;
  const version = view ? draftVersion(view.draft.generatedAt, view.draft.editedAt) : null;
  const reloadAt = memberId ? reloadKey(memberId, step) : null;
  useEffect(() => { dispatch({ type: "props", open, key: reloadAt, marker: m }); }, [open, reloadAt, m]);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => dispatch({ type: "timeout" }), RELOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [pending]);
  // Opening is the review: report it once per open (and once per explicit reload), never from a passive listing or a
  // background refresh. The version sent is the one of the render the form was mounted with, which is what the person read.
  useEffect(() => {
    if (marks && memberId && version) onAction({ type: "markReviewed", memberId, step, version });
    // The intent is per open; a new onAction identity must not re-report it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks, memberId, step, reads]);
  if (!m || !view) return null;

  const name = [m.firstName, m.lastName].filter(Boolean).join(" ") || l.unnamed;
  // An unapproved step 1 draft in another language than today's: the exits are in the alert, Aprobar waits (the server refuses it too).
  const mismatch = !view.readOnly && step === 1 && view.kind === "draft" ? memberDraftMismatch(m) : null;
  const helpId = `${formId}-language-help`;
  const blockedTitle = mismatch ? fill(l.languageMismatch.approveTitle, { draft: languageWord(mismatch.draft, l), now: languageWord(mismatch.now, l) }) : undefined;
  const title = [name, [m.jobTitle?.trim() || l.noTitle, m.company && `${l.headlineAt} ${m.company}`].filter(Boolean).join(" ")].join(" · ");
  const when = (d: Date) => { const w = miamiWhen(d, now); return `${w.ddmm} ${w.hhmm}`; };
  // Null for a member stopped before anything was sent: there is no cadence to show (reviewDialog.ts kindOf).
  const { cadence } = view;
  const editedAgo = view.editedAt ? agoText(view.editedAt, now, l) : "";
  const step1Lead = !cadence ? null : cadence.step1.kind === "sent" ? fill(l.emailSent, { ago: agoText(cadence.step1.at, now, l) }) : cadence.step1.kind === "scheduled" ? l.reviewReleases : l.reviewReleasesIfApproved;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (view?.readOnly || !memberId) return;
    const intent = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value");
    const data = new FormData(e.currentTarget);
    if (intent === "save") onAction({ type: "save", memberId, step, subject: String(data.get("subject") ?? ""), body: String(data.get("body") ?? "") });
    // The reminder (step 2) is approved with a plain button: it has no choice of moment.
    if (intent === "approve") onAction({ type: "approve", memberId, step, subject: String(data.get("subject") ?? ""), body: String(data.get("body") ?? "") });
  }
  /** The split button is outside the form's submit flow, so it reads the text as it stands in the form. */
  const approveWith = (when: SendChoice) => {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement) || !memberId) return;
    const data = new FormData(form);
    return onAction({ type: "approve", memberId, step, subject: String(data.get("subject") ?? ""), body: String(data.get("body") ?? ""), when });
  };
  // Always asks the server without a confirmation: it refuses to overwrite an edit and the container then confirms with the BD.
  const footerButton = (id: ReviewFooterId) =>
    id === "regenerate" ? (
      <button key={id} type="button" className="btn btn-ghost left" disabled={busy || regenerateLocked} onClick={() => onAction({ type: "regenerate", memberId: m.memberId, step })}><GenerateIcon className="icon" />{l.reviewRegenerate}</button>
    ) : id === "approve" && step === 1 ? (
      <SendSplitButton
        key={id}
        labels={send.labels}
        primaryLabel={l.reviewApproveNow}
        busy={busy}
        disabled={mismatch !== null}
        title={blockedTitle}
        describedBy={mismatch ? helpId : undefined}
        error={send.error}
        schedule={approvalSchedule(send, [{ name, zone: resolveRecipientZone(m.place ?? {}) }], "one")}
        cadence={{ hint: cadenceHint(now, send.schedule, l), onPick: () => approveWith({ kind: "cadence" }) }}
        onSendNow={() => approveWith({ kind: "now" })}
        onSchedule={async (slot) => { await approveWith({ kind: "at", ...slot }); }}
      />
    ) : (
      <button key={id} type="submit" form={formId} value={id} className={`btn ${id === "approve" ? "btn-primary" : "btn-secondary"}`} disabled={busy || (id === "approve" && mismatch !== null)} title={id === "approve" ? blockedTitle : undefined} aria-describedby={id === "approve" && mismatch ? helpId : undefined}>{id === "approve" ? l.reviewApprove : l.reviewSave}</button>
    );

  return (
    <Dialog open={open} onClose={onClose} title={title} wide closeDisabled={busy}
      footer={view.readOnly ? <button type="button" className="btn btn-secondary" onClick={onClose}>{l.reviewClose}</button> : mismatch ? (
        // The help line lives IN the footer so it cannot scroll away from the disabled button it explains.
        <div className="stack-sm" style={{ width: "100%" }}><p className="help" id={helpId}>{l.languageMismatch.dialogApproveHelp}</p><div className="row" style={{ justifyContent: "flex-end" }}>{view.footer.map(footerButton)}</div></div>
      ) : view.footer.map(footerButton)}>
      <form id={formId} className="stack" onSubmit={submit} key={`${m.memberId}-${step}-${reads}`}>
        {(stale || pending !== null) && (
          <div className="alert alert-warn" role="alert">
            <WarningIcon className="icon" />
            <div className="grow">{l.reviewStaleNotice}</div>
            <button type="button" className="btn btn-secondary btn-sm" disabled={pending !== null} onClick={() => { dispatch({ type: "click", key: reloadKey(m.memberId, step), marker: m }); onAction({ type: "reloadCurrent", memberId: m.memberId, step }); }}>{l.reviewStaleReload}</button>
          </div>
        )}
        {mismatch && <LanguageMismatchAlert m={m} mismatch={mismatch} name={name} l={l} ownView={ownView} explain busy={busy} locked={regenerateLocked} onRegenerate={() => onAction({ type: "regenerate", memberId: m.memberId, step })} onKeep={() => onAction({ type: "keepLanguage", memberId: m.memberId, step })} />}
        {readOnly ? (
          <div className="alert alert-neutral"><EyeIcon className="icon" /><div>{fill(l.readOnlyDialogNotice, { owner: ownerName })}</div></div>
        ) : (
        <div className="alert alert-info">
          <InfoIcon className="icon" />
          <div>
            {view.kind === "sent" && l.reviewSentNotice}
            {view.kind === "stopped" && l.reviewStoppedNotice}
            {view.kind === "reminder" && fill(l.reviewReminderNotice, { date: miamiWhen(m.sentAt ?? now, now).ddmm })}
            {view.kind === "approved" && fill(l.reviewApprovedNotice, { ago: view.draft.approvedAt ? agoText(view.draft.approvedAt, now, l) : "" })}
            {(view.kind === "draft" || view.kind === "reminder") && view.edited && <> {l.reviewEditedLead} <strong>{ownView ? l.reviewEditedStrong : l.reviewEditedStrongOther}</strong>{fill(ownView ? l.reviewEditedRest : l.reviewEditedRestOther, { ago: editedAgo })} {ownView ? l.reviewEditedTail : l.reviewEditedTailOther}</>}
            {(view.kind === "draft" || view.kind === "reminder") && !view.edited && <> {l.reviewNotice} <strong>{l.reviewNoticeStrong}</strong> {ownView ? l.reviewNoticeTail : l.reviewNoticeTailOther}</>}
          </div>
        </div>
        )}
        {!view.readOnly && signals && (
          <div className="field"><span className="label">{l.reviewSignals}</span>
            {signals.length > 0 ? <div className="row wrap row-xs">{signals.map((s) => <span key={s} className="chip">{s}</span>)}</div> : <p className="help">{l.reviewSignalsNone}</p>}
            <p className="help">{view.edited ? <>{l.reviewSignalsEditedLead} <strong>{l.reviewSignalsEditedStrong}</strong> {ownView ? l.reviewSignalsEditedTail : l.reviewSignalsEditedTailOther}</> : l.reviewSignalsHelp}</p>
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
        <div className="field"><label className="label" htmlFor={`${formId}-body`}>{l.reviewBody}{mismatch && <> <span className="badge badge-warn">{fill(l.languageMismatch.dialogBodyBadge, { draft: languageWord(mismatch.draft, l) })}</span></>}</label>
          <textarea className="textarea" id={`${formId}-body`} name="body" rows={11} defaultValue={view.draft.body} readOnly={view.readOnly} required />
          {!view.readOnly && <p className="help">{l.reviewBodyHelp}</p>}
          {/* Plain `help`: the mockup never drew this warning, so it has no approved emphasis style. Styling it is a
              PR 13 visual-review question; saying it at all is not optional. */}
          {view.kind === "approved" && !view.readOnly && <p className="help">{l.reviewApprovedEditWarning}</p>}
        </div>
        {cadence && (
          <div className="field"><span className="label">{l.reviewCadence}</span>
            <div className="assoc">
              <div className="assoc-row"><span className="badge badge-mono">{l.cadenceStep1}</span><span className="grow">
                {step === 1 && cadence.step1.kind === "ifApprovedNow" ? (
                  <>{l.reviewChoiceLead} <strong>{l.reviewChoiceStrong}</strong>{l.reviewChoiceTail}</>
                ) : (
                  <>{step1Lead}{cadence.step1.kind !== "sent" && <> <strong>{when(cadence.step1.at)}</strong> {l.reviewMiami}</>}</>
                )}
              </span></div>
              <div className="assoc-row"><span className="badge badge-mono">{l.cadenceStep2}</span><span className="grow">{l.reviewReminderOn} <strong>{miamiWhen(cadence.reminderAt, now).ddmm}</strong>{l.cadenceStep2Tail}</span></div>
            </div>
          </div>
        )}
        {error && <span className="error-text" role="alert">{error}</span>}
      </form>
    </Dialog>
  );
}

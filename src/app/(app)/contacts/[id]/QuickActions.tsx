"use client";

import { argentinaCalendarDate } from "@/lib/tasks/argentinaDate";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { contactActionErrorMessage, type ContactRecordLabels } from "@/lib/contacts/labels";
import { contactActionErrorHref } from "../actionErrors";
import { settleAction } from "@/lib/contacts/actionOutcome";
import {
  addContactSignalAction,
  addContactTaskAction,
  discardContactAction,
  logCallAction,
  logContactMeetingAction,
  sendContactEmailAction,
} from "../actions";
import { CALL_OUTCOME_CODES, MANUAL_CALL_DIRECTION, type CallOutcomeCode } from "@/lib/contacts/call";
import { buildTaskAssigneeOptions } from "@/lib/tasks/assignee";
import { generatePersonOutreachMessageAction } from "../messageActions";
import { GenerateMessageDialog } from "./GenerateMessageDialog";
import type { GenerateMessageLabels } from "@/lib/outreach/messageLabels";
import type { Locale } from "@/lib/i18n/locales";
import { DISCARD_REASON_CODES, type DiscardReasonCode } from "@/lib/contacts/discard";
import { Dialog } from "@/components/Dialog";
import { useToast } from "@/components/ToastProvider";
import {
  CallIcon,
  ClipboardIcon,
  DiscardIcon,
  GenerateIcon,
  MailIcon,
  MeetingIcon,
  NoteIcon,
  TasksIcon,
} from "@/components/icons";

export interface TaskAssigneeOption {
  id: string;
  name: string;
}

export interface QuickActionsProps {
  personId: string;
  name: string;
  labels: ContactRecordLabels;
  email: string | null;
  // "Generar mensaje" / "Redactar con IA" (both open GenerateMessageDialog,
  // task 13.3) — needs its own ClientStrings-safe labels slice and the
  // record page's (Spanish-only) locale fallback, same as /outreach and
  // /whats-new.
  messageLabels: GenerateMessageLabels;
  locale: Locale;
  // Board drag/keyboard-menu handoff (task 10.5, 14.1), plus the follow-up
  // queue's deep-link quick actions: pre-opens this composer on mount, e.g.
  // arriving from `/contacts/[id]?openAction=meeting`.
  initialAction?: "email" | "meeting" | "discard" | "call" | "task" | null;
  // "Tarea" quick action's assignee `<select>` (task-essentials backlog item
  // 2) — the same `bd` list `PropertyList`'s owner `<select>` already uses.
  assigneeOptions: TaskAssigneeOption[];
  // Current BD's id (preselects "Asignado a", marks that option "(yo)") and
  // this Contact's own owner (marks their option "(responsable)" — already
  // loaded on the record page as `ownerBdId`, never fetched here).
  meId: string;
  ownerBdId: string | null;
}

type QuickAction = "call" | "email" | "task" | "meeting" | "discard" | "signal" | "generate" | null;

const CALL_OUTCOME_LABEL_KEY: Record<CallOutcomeCode, keyof ContactRecordLabels> = {
  connected: "callOutcomeConnected",
  busy: "callOutcomeBusy",
  no_answer: "callOutcomeNoAnswer",
  voicemail: "callOutcomeVoicemail",
  wrong_number: "callOutcomeWrongNumber",
};

const DISCARD_REASON_LABEL_KEY: Record<DiscardReasonCode, keyof ContactRecordLabels> = {
  wrong_profile: "discardReasonWrongProfile",
  not_interested: "discardReasonNotInterested",
  other_vendor: "discardReasonOtherVendor",
  left_company: "discardReasonLeftCompany",
  bad_data: "discardReasonBadData",
  other: "discardReasonOther",
};

export interface ActionError {
  message: string;
  href?: string;
}

export interface ComposerProps {
  labels: ContactRecordLabels;
  busy: boolean;
  error: ActionError | null;
  onCancel: () => void;
}

function ErrorNotice({ labels: l, error }: { labels: ContactRecordLabels; error: ActionError }) {
  return (
    <div className={"error-text"} role="alert">
      {error.message}
      {error.href && (
        <>
          {" "}
          <Link href={error.href}>{l.gmailReconnectLink}</Link>
        </>
      )}
    </div>
  );
}

/**
 * Quick actions row (task 9.2): Nota/Correo/Tarea wired; Reunión/Descartar
 * wired in PR 10b (tasks 10.2/10.3) to logContactMeetingAction /
 * discardContactAction. "Pegar señal" added in task 11.6 to close the
 * feature-parity gap flagged in PR 11c (legacy `/leads/[id]` and
 * `/contact/[id]` "+ Paste signal" composer had no equivalent here).
 */
export function QuickActions({
  personId,
  name,
  labels: l,
  email,
  messageLabels,
  locale,
  initialAction,
  assigneeOptions,
  meId,
  ownerBdId,
}: QuickActionsProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [openAction, setOpenAction] = useState<QuickAction>(initialAction ?? null);
  const [error, setError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);
  // The email composer's draft, lifted OUT of EmailForm (fresh-review fix):
  // "Redactar con IA" switches `openAction` to "generate", which unmounts
  // EmailForm — a subject/body kept in EmailForm's own useState would be
  // lost on that round trip. Living here, they survive it; `closeQuickAction`
  // clears them once the email composer itself is closed or sent, so a
  // stale draft never pre-fills the NEXT "Correo".
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  // Where the "generate" panel's own close button (Esc/×) should go:
  // back to the email composer (opened via "Redactar con IA", draft above
  // kept intact) or fully closed (opened via the top-level "Generar
  // mensaje" CTA, nothing else was open). Cleared on every route out of
  // "generate" so it never leaks into an unrelated later open.
  const [generateReturnTo, setGenerateReturnTo] = useState<"email" | null>(null);

  function closeQuickAction() {
    setOpenAction(null);
    setError(null);
    setEmailSubject("");
    setEmailBody("");
    setGenerateReturnTo(null);
  }

  function closeGenerate() {
    if (generateReturnTo === "email") {
      setGenerateReturnTo(null);
      setOpenAction("email");
    } else {
      closeQuickAction();
    }
  }

  function toggle(action: QuickAction) {
    setOpenAction(openAction === action ? null : action);
  }

  return (
    <>
      <div className="quick-actions" role="toolbar" aria-label={l.aboutSectionTitle}>
        {/* Mockup's "Nota" quick action (contact-record.html:67) is a plain
            `#log-note` anchor scrolling to the PINNED note composer
            (NoteComposer.tsx, always visible above the timeline) — not its
            own toggle panel like the other actions below. */}
        <a className="qa" href="#log-note">
          <span className="qa-icon">
            <NoteIcon className="icon" />
          </span>
          {l.quickActionNote}
        </a>
        <button type="button" className="qa" onClick={() => toggle("call")}>
          <span className="qa-icon">
            <CallIcon className="icon" />
          </span>
          {l.quickActionCall}
        </button>
        <button type="button" className="qa" onClick={() => toggle("email")}>
          <span className="qa-icon">
            <MailIcon className="icon" />
          </span>
          {l.quickActionEmail}
        </button>
        <button type="button" className="qa" onClick={() => toggle("task")}>
          <span className="qa-icon">
            <TasksIcon className="icon" />
          </span>
          {l.quickActionTask}
        </button>
        <button type="button" className="qa" onClick={() => toggle("meeting")}>
          <span className="qa-icon">
            <MeetingIcon className="icon" />
          </span>
          {l.quickActionMeeting}
        </button>
        <button type="button" className="qa danger" onClick={() => toggle("discard")}>
          <span className="qa-icon">
            <DiscardIcon className="icon" />
          </span>
          {l.quickActionDiscard}
        </button>
        {/* "Pegar señal" (task 11.6) is not one of this mockup's 5 quick
            actions — an intentional superset kept per owner decision
            (2026-09-26): styled identically to the other five so it reads
            as a first-class action, not a bolted-on extra. */}
        <button type="button" className="qa" onClick={() => toggle("signal")}>
          <span className="qa-icon">
            <ClipboardIcon className="icon" />
          </span>
          {l.quickActionSignal}
        </button>
      </div>

      <button type="button" className="btn btn-secondary btn-block mt-md" onClick={() => toggle("generate")}>
        <GenerateIcon className="icon" />
        {l.generateMessageCta}
      </button>

      {openAction === "generate" && (
        <GenerateMessageDialog
          title={`${l.generateMessageCta} · ${name}`}
          onClose={closeGenerate}
          boundAction={generatePersonOutreachMessageAction.bind(null, personId, locale)}
          labels={messageLabels}
          useInEmailLabel={l.useInEmailAction}
          onUseInEmail={(subject, body) => {
            // Explicit "Usar en correo" click — replaces whatever was
            // already typed (same as this generator always did before it
            // moved into a dialog of its own). Closing WITHOUT this click
            // (Esc/×) leaves the draft above untouched — see closeGenerate.
            setEmailSubject(subject);
            setEmailBody(body);
            setGenerateReturnTo(null);
            setOpenAction("email");
          }}
        />
      )}

      {openAction === "call" && (
        <CallForm
          labels={l}
          busy={busy}
          error={error}
          onCancel={closeQuickAction}
          onSubmit={async (outcome, date, time, notes) => {
            setBusy(true);
            setError(null);
            // Direction has no control on purpose: a hand-logged call is outbound,
            // and `outbound` is what makes a no-answer call count as `contacted`.
            const result = await settleAction(() => logCallAction(personId, outcome, MANUAL_CALL_DIRECTION, date, time, notes));
            setBusy(false);
            // The write may have landed: show the timeline as it is now, so
            // "revisar" points at the truth and not at a stale screen.
            if (!result.ok && result.reason === "unconfirmed") router.refresh();
            if (result.ok) {
              closeQuickAction();
              showToast(l.toastCallLogged);
              router.refresh();
            } else {
              const message = contactActionErrorMessage(l, result.reason);
              setError({ message });
              showToast(message, "error");
            }
          }}
        />
      )}

      {openAction === "task" && (
        <TaskForm
          labels={l}
          busy={busy}
          error={error}
          assigneeOptions={assigneeOptions}
          meId={meId}
          ownerBdId={ownerBdId}
          onCancel={closeQuickAction}
          onSubmit={async (title, dueAt, description, assignedToBdId) => {
            setBusy(true);
            setError(null);
            const result = await settleAction(() => addContactTaskAction(personId, title, dueAt, description, assignedToBdId));
            setBusy(false);
            // The write may have landed: show the timeline as it is now, so
            // "revisar" points at the truth and not at a stale screen.
            if (!result.ok && result.reason === "unconfirmed") router.refresh();
            if (result.ok) {
              closeQuickAction();
              showToast(l.toastTaskCreated);
              router.refresh();
            } else {
              const message = contactActionErrorMessage(l, result.reason);
              setError({ message, href: contactActionErrorHref(result.reason) });
              showToast(message, "error");
            }
          }}
        />
      )}

      {openAction === "email" && (
        <EmailForm
          labels={l}
          to={email}
          busy={busy}
          error={error}
          subject={emailSubject}
          body={emailBody}
          onSubjectChange={setEmailSubject}
          onBodyChange={setEmailBody}
          onOpenGenerate={() => {
            setGenerateReturnTo("email");
            setOpenAction("generate");
          }}
          onCancel={closeQuickAction}
          onSubmit={async (subject, body) => {
            if (!email) return;
            setBusy(true);
            setError(null);
            const result = await settleAction(() => sendContactEmailAction(personId, email, subject, body));
            setBusy(false);
            // The write may have landed: show the timeline as it is now, so
            // "revisar" points at the truth and not at a stale screen.
            if (!result.ok && result.reason === "unconfirmed") router.refresh();
            if (result.ok) {
              closeQuickAction();
              showToast(l.toastEmailSent);
              router.refresh();
            } else {
              const message = contactActionErrorMessage(l, result.reason);
              setError({ message, href: contactActionErrorHref(result.reason) });
              showToast(message, "error");
            }
          }}
        />
      )}

      {openAction === "meeting" && (
        <MeetingForm
          labels={l}
          busy={busy}
          error={error}
          onCancel={closeQuickAction}
          onSubmit={async (date, time, notes) => {
            setBusy(true);
            setError(null);
            const result = await settleAction(() => logContactMeetingAction(personId, date, time, notes));
            setBusy(false);
            // The write may have landed: show the timeline as it is now, so
            // "revisar" points at the truth and not at a stale screen.
            if (!result.ok && result.reason === "unconfirmed") router.refresh();
            if (result.ok) {
              closeQuickAction();
              showToast(l.toastMeetingLogged);
              router.refresh();
            } else {
              const message = contactActionErrorMessage(l, result.reason);
              setError({ message });
              showToast(message, "error");
            }
          }}
        />
      )}

      {openAction === "discard" && (
        <DiscardForm
          labels={l}
          busy={busy}
          error={error}
          onCancel={closeQuickAction}
          onSubmit={async (reason, note) => {
            setBusy(true);
            setError(null);
            const result = await settleAction(() => discardContactAction(personId, reason, note));
            setBusy(false);
            // The write may have landed: show the timeline as it is now, so
            // "revisar" points at the truth and not at a stale screen.
            if (!result.ok && result.reason === "unconfirmed") router.refresh();
            if (result.ok) {
              closeQuickAction();
              showToast(l.toastDiscarded);
              router.refresh();
            } else {
              const message = contactActionErrorMessage(l, result.reason);
              setError({ message });
              showToast(message, "error");
            }
          }}
        />
      )}

      {openAction === "signal" && (
        <SignalForm
          labels={l}
          busy={busy}
          error={error}
          onCancel={closeQuickAction}
          onSubmit={async (text) => {
            setBusy(true);
            setError(null);
            const result = await settleAction(() => addContactSignalAction(personId, text));
            setBusy(false);
            // The write may have landed: show the timeline as it is now, so
            // "revisar" points at the truth and not at a stale screen.
            if (!result.ok && result.reason === "unconfirmed") router.refresh();
            if (result.ok) {
              closeQuickAction();
              showToast(l.toastSignalSaved);
              router.refresh();
            } else {
              const message = contactActionErrorMessage(l, result.reason);
              setError({ message });
              showToast(message, "error");
            }
          }}
        />
      )}
    </>
  );
}

function TaskForm({
  labels: l,
  busy,
  error,
  assigneeOptions,
  meId,
  ownerBdId,
  onCancel,
  onSubmit,
}: ComposerProps & {
  assigneeOptions: TaskAssigneeOption[];
  meId: string;
  ownerBdId: string | null;
  onSubmit: (title: string, dueAt: Date | undefined, description: string | undefined, assignedToBdId: string) => void;
}) {
  const ids = useId();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assignedToBdId, setAssignedToBdId] = useState(meId);
  return (
    <Dialog
      open
      onClose={onCancel}
      closeDisabled={busy}
      title={l.taskCreate}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            {l.cancel}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !title.trim()}
            onClick={() =>
              title.trim() &&
              onSubmit(title.trim(), dueDate ? new Date(dueDate) : undefined, description.trim() || undefined, assignedToBdId)
            }
          >
            {l.taskCreate}
          </button>
        </>
      }
    >
      {/* Markup follows the approved mockup's task dialog
          (contact-record.html #task): `.field` > `label.label[for]` + control
          inside Dialog's `.dialog-body`, actions in its `.dialog-footer` —
          same fix as NewTaskButton.tsx (a `.composer` wrapper lit the whole
          form red on focus, and unclassed buttons fell back to the legacy
          red `:where(button)` style). */}
      {error && <ErrorNotice labels={l} error={error} />}
      <div className="field">
        <label className="label" htmlFor={`${ids}-title`}>
          {l.taskTitleLabel}
        </label>
        <input
          id={`${ids}-title`}
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={busy}
        />
      </div>
      {/* Vencimiento + Asignado a side by side (approved mockup
          contact-record.html #task's `.form-grid`). */}
      <div className="form-grid">
        <div className="field">
          <label className="label" htmlFor={`${ids}-due`}>
            {l.taskDueLabel}
          </label>
          <input
            id={`${ids}-due`}
            className="input"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor={`${ids}-assignee`}>
            {l.taskAssigneeLabel}
          </label>
          <select
            id={`${ids}-assignee`}
            className="select"
            value={assignedToBdId}
            onChange={(e) => setAssignedToBdId(e.target.value)}
            disabled={busy}
          >
            {buildTaskAssigneeOptions(assigneeOptions, meId, ownerBdId).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {/* Descripción: not in the approved mockup — a deliberate deviation,
          kept because the backlog explicitly asked for a write path. */}
      <div className="field">
        <label className="label" htmlFor={`${ids}-description`}>
          {l.taskDescriptionLabel}
        </label>
        <textarea
          id={`${ids}-description`}
          className="textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={busy}
        />
      </div>
    </Dialog>
  );
}

function EmailForm({
  labels: l,
  to,
  busy,
  error,
  subject,
  body,
  onSubjectChange,
  onBodyChange,
  onOpenGenerate,
  onCancel,
  onSubmit,
}: ComposerProps & {
  to: string | null;
  // Controlled by the caller (QuickActions), not local state (fresh-review
  // fix): "Redactar con IA" below unmounts this form while the "Generar
  // mensaje" dialog is open, which would silently drop a locally-held draft.
  // Living in the parent, it survives that round trip.
  subject: string;
  body: string;
  onSubjectChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  // "Redactar con IA" (approved mockup contact-record.html #email's
  // `.dialog-footer`: `btn btn-ghost left`, before Cancelar/Enviar) opens
  // the SAME "Generar mensaje" dialog the top-level quick action uses
  // (QuickActions' openAction "generate" — GenerateMessageDialog.tsx),
  // which hands the draft back via onUseInEmail. Omitted entirely (rather
  // than rendered disabled) when the caller has nothing to open, keeping
  // this composer reusable for a context with no AI draft (none today, but
  // no reason to hard-couple the two).
  onOpenGenerate?: () => void;
  onSubmit: (subject: string, body: string) => void;
}) {
  const ids = useId();

  if (!to) {
    return (
      <Dialog open onClose={onCancel} title={l.quickActionEmail}>
        <p>{l.emailNoAddress}</p>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onCancel}
      closeDisabled={busy}
      title={l.quickActionEmail}
      wide
      footer={
        <>
          {/* Approved mockup (contact-record.html #email's `.dialog-footer`):
              "Redactar con IA" is `btn btn-ghost left`, before Cancelar/
              Enviar — moved here from an inline body button (fresh-review
              fix), same position/class GenerateMessageDialog's own
              "Generar"/"Regenerar" action already uses. */}
          {onOpenGenerate && (
            <button type="button" className="btn btn-ghost left" onClick={onOpenGenerate} disabled={busy}>
              <GenerateIcon className="icon" />
              {l.emailGenerateAction}
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            {l.cancel}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !body.trim()}
            onClick={() => body.trim() && onSubmit(subject.trim(), body.trim())}
          >
            {l.emailSend}
          </button>
        </>
      }
    >
      {error && <ErrorNotice labels={l} error={error} />}
      <div className="field">
        <label className="label" htmlFor={`${ids}-to`}>
          {l.emailToLabel}
        </label>
        <input id={`${ids}-to`} className="input" value={to} disabled />
      </div>
      <div className="field">
        <label className="label" htmlFor={`${ids}-subject`}>
          {l.emailSubjectLabel}
        </label>
        <input
          id={`${ids}-subject`}
          className="input"
          value={subject}
          onChange={(e) => onSubjectChange(e.target.value)}
          disabled={busy}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor={`${ids}-body`}>
          {l.emailBodyLabel}
        </label>
        <textarea
          id={`${ids}-body`}
          className="textarea"
          value={body}
          onChange={(e) => onBodyChange(e.target.value)}
          disabled={busy}
        />
      </div>
    </Dialog>
  );
}

export function CallForm({
  labels: l,
  busy,
  error,
  onCancel,
  onSubmit,
}: ComposerProps & {
  onSubmit: (outcome: string, date: string, time: string, notes: string) => void;
}) {
  const ids = useId();
  const [outcome, setOutcome] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");

  // Client-side "no future call" guard (fresh-review WARNING fix) —
  // mirrors planCall's server-side FUTURE_CLOCK_SKEW_TOLERANCE_MS check
  // (src/lib/contacts/call.ts), which is the actual source of truth; this
  // only keeps the date/time pickers from offering an obviously-rejected
  // value in the first place. `timeMax` only applies when the picked date
  // is today (or still blank, which defaults to today) — a past date has
  // no future hour to guard against.
  const now = new Date();
  const dateMax = now.toISOString().slice(0, 10);
  const timeMax = date === "" || date === dateMax ? now.toTimeString().slice(0, 5) : undefined;

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
            disabled={busy || !outcome}
            onClick={() => outcome && onSubmit(outcome, date, time, notes)}
          >
            {l.callSubmit}
          </button>
        </>
      }
    >
      {error && <ErrorNotice labels={l} error={error} />}
      <div className="field">
        <label className="label" htmlFor={`${ids}-outcome`}>
          {l.callOutcomeLabel}
        </label>
        <select
          id={`${ids}-outcome`}
          className="select"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          disabled={busy}
        >
          <option value="">{l.callOutcomePlaceholder}</option>
          {CALL_OUTCOME_CODES.map((code) => (
            <option key={code} value={code}>
              {l[CALL_OUTCOME_LABEL_KEY[code]] as string}
            </option>
          ))}
        </select>
      </div>
      <div className="form-grid">
        <div className="field">
          <label className="label" htmlFor={`${ids}-date`}>
            {l.callDateLabel}
          </label>
          <input
            id={`${ids}-date`}
            className="input"
            type="date"
            value={date}
            max={dateMax}
            onChange={(e) => setDate(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor={`${ids}-time`}>
            {l.callTimeLabel}
          </label>
          <input
            id={`${ids}-time`}
            className="input"
            type="time"
            value={time}
            max={timeMax}
            onChange={(e) => setTime(e.target.value)}
            disabled={busy}
          />
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor={`${ids}-notes`}>
          {l.callNotesLabel}
        </label>
        <textarea
          id={`${ids}-notes`}
          className="textarea"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={busy}
        />
      </div>
      <p className="help">{l.callHelp}</p>
    </Dialog>
  );
}

export function MeetingForm({
  labels: l,
  busy,
  error,
  onCancel,
  onSubmit,
}: ComposerProps & { onSubmit: (date: string, time: string, notes: string) => void }) {
  const ids = useId();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <Dialog
      open
      onClose={onCancel}
      closeDisabled={busy}
      title={l.meetingSubmit}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            {l.cancel}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !date}
            onClick={() => date && onSubmit(date, time, notes)}
          >
            {l.meetingSubmit}
          </button>
        </>
      }
    >
      {error && <ErrorNotice labels={l} error={error} />}
      {/* Fecha + Hora side by side (approved mockup contact-record.html
          #meeting's `.form-grid`). */}
      <div className="form-grid">
        <div className="field">
          <label className="label" htmlFor={`${ids}-date`}>
            {l.meetingDateLabel}
          </label>
          <input
            id={`${ids}-date`}
            className="input"
            type="date"
            // Courtesy only (the server guard is the real check): same ART day as futureGuard.ts.
            max={argentinaCalendarDate(new Date())}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor={`${ids}-time`}>
            {l.meetingTimeLabel}
          </label>
          <input
            id={`${ids}-time`}
            className="input"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            disabled={busy}
          />
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor={`${ids}-notes`}>
          {l.meetingNotesLabel}
        </label>
        <textarea
          id={`${ids}-notes`}
          className="textarea"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={busy}
        />
      </div>
      <p className="help">{l.meetingHelp}</p>
    </Dialog>
  );
}

export function DiscardForm({
  labels: l,
  busy,
  error,
  onCancel,
  onSubmit,
}: ComposerProps & { onSubmit: (reason: string | null, note: string) => void }) {
  const ids = useId();
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const requiresNote = reason === "other";

  return (
    <Dialog
      open
      onClose={onCancel}
      closeDisabled={busy}
      title={l.discardSubmit}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            {l.cancel}
          </button>
          {/* mockup's Descartar action renders `.btn-danger-solid` (contact-
              record.html #discard), not `.btn-primary` — this is a
              destructive action. */}
          <button
            type="button"
            className="btn btn-danger-solid"
            disabled={busy || !reason || (requiresNote && !note.trim())}
            onClick={() => onSubmit(reason || null, note)}
          >
            {l.discardSubmit}
          </button>
        </>
      }
    >
      {error && <ErrorNotice labels={l} error={error} />}
      <div className="field">
        <label className="label" htmlFor={`${ids}-reason`}>
          {l.discardReasonLabel}
        </label>
        <select
          id={`${ids}-reason`}
          className="select"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
        >
          <option value="">{l.discardReasonPlaceholder}</option>
          {DISCARD_REASON_CODES.map((code) => (
            <option key={code} value={code}>
              {l[DISCARD_REASON_LABEL_KEY[code]] as string}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="label" htmlFor={`${ids}-note`}>
          {l.discardNoteLabel}
        </label>
        <textarea
          id={`${ids}-note`}
          className="textarea"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={busy}
        />
        {requiresNote && <p className="hint">{l.discardNoteRequiredHint}</p>}
      </div>
    </Dialog>
  );
}

function SignalForm({
  labels: l,
  busy,
  error,
  onCancel,
  onSubmit,
}: ComposerProps & { onSubmit: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="composer">
      {error && <ErrorNotice labels={l} error={error} />}
      <textarea
        className="textarea"
        placeholder={l.signalPlaceholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
      />
      <div className="bar">
        {/* Unclassed buttons here fell back to the legacy `:where(button)`
            style (same bug class as the Dialog markup sweep — PRs 189-193 —
            just outside a Dialog; this composer is the pinned-style pattern
            NoteComposer.tsx also uses, not a bug on its own). */}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
          {l.cancel}
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => text.trim() && onSubmit(text.trim())}
          disabled={busy || !text.trim()}
        >
          {l.signalSave}
        </button>
      </div>
    </div>
  );
}

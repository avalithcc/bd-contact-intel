"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { contactActionErrorMessage, type ContactRecordLabels } from "@/lib/contacts/labels";
import { contactActionErrorHref } from "../actionErrors";
import {
  addContactSignalAction,
  addContactTaskAction,
  discardContactAction,
  logCallAction,
  logContactMeetingAction,
  sendContactEmailAction,
} from "../actions";
import { CALL_DIRECTIONS, CALL_OUTCOME_CODES, type CallDirection, type CallOutcomeCode } from "@/lib/contacts/call";
import { buildTaskAssigneeOptions } from "@/lib/tasks/assignee";
import { generatePersonOutreachMessageAction } from "../messageActions";
import { GenerateMessageButton } from "@/app/(app)/outreach/GenerateMessageButton";
import { GenerateMessageDialog } from "./GenerateMessageDialog";
import { splitEmailDraft } from "@/lib/outreach/emailDraftFormat";
import type { GenerateOutreachMessageResult } from "@/app/(app)/outreach/actions";
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
  // "Generar mensaje" (task 13.3) reuses /outreach's GenerateMessageButton —
  // needs its own ClientStrings-safe labels slice and the record page's
  // (Spanish-only) locale fallback, same as /outreach and /whats-new.
  messageLabels: GenerateMessageLabels;
  locale: Locale;
  // Board drag/keyboard-menu handoff (task 10.5, 14.1): pre-opens this
  // composer on mount, e.g. arriving from `/contacts/[id]?openAction=meeting`.
  initialAction?: "email" | "meeting" | "discard" | null;
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

const CALL_DIRECTION_LABEL_KEY: Record<CallDirection, keyof ContactRecordLabels> = {
  outbound: "callDirectionOutbound",
  inbound: "callDirectionInbound",
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
  // Filled by "Generar mensaje" (see the EmailForm render below) — kept
  // here (not inside EmailForm's own state) so a fresh generation before
  // the email panel is opened still has somewhere to land.
  const [generatedBody, setGeneratedBody] = useState<string | null>(null);
  const [generatedSubject, setGeneratedSubject] = useState<string | null>(null);

  function closeQuickAction() {
    setOpenAction(null);
    setError(null);
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
        <Dialog open onClose={closeQuickAction} title={`${l.generateMessageCta} · ${name}`} wide>
          <GenerateMessageDialog
            boundAction={generatePersonOutreachMessageAction.bind(null, personId, locale)}
            labels={messageLabels}
            useInEmailLabel={l.useInEmailAction}
            onUseInEmail={(subject, body) => {
              setGeneratedSubject(subject);
              setGeneratedBody(body);
              setOpenAction("email");
            }}
          />
        </Dialog>
      )}

      {openAction === "call" && (
        <CallForm
          labels={l}
          busy={busy}
          error={error}
          onCancel={closeQuickAction}
          onSubmit={async (outcome, direction, date, time, durationMinutes, notes) => {
            setBusy(true);
            setError(null);
            const result = await logCallAction(personId, outcome, direction, date, time, durationMinutes, notes);
            setBusy(false);
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
            const result = await addContactTaskAction(personId, title, dueAt, description, assignedToBdId);
            setBusy(false);
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
          initialSubject={generatedSubject}
          initialBody={generatedBody}
          generate={{
            labels: messageLabels,
            boundAction: generatePersonOutreachMessageAction.bind(null, personId, locale),
            onGenerated: setGeneratedBody,
          }}
          onCancel={closeQuickAction}
          onSubmit={async (subject, body) => {
            if (!email) return;
            setBusy(true);
            setError(null);
            const result = await sendContactEmailAction(personId, email, subject, body);
            setBusy(false);
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
            const result = await logContactMeetingAction(personId, date, time, notes);
            setBusy(false);
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
            const result = await discardContactAction(personId, reason, note);
            setBusy(false);
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
            const result = await addContactSignalAction(personId, text);
            setBusy(false);
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
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assignedToBdId, setAssignedToBdId] = useState(meId);
  return (
    <Dialog open onClose={onCancel} title={l.taskCreate}>
      <div className="composer">
        {error && <ErrorNotice labels={l} error={error} />}
        <label className="field">
          {l.taskTitleLabel}
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
        </label>
        {/* Vencimiento + Asignado a side by side (approved mockup
            contact-record.html #task's `.form-grid`). */}
        <div className="form-grid">
          <label className="field">
            {l.taskDueLabel}
            <input
              className="input"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="field">
            {l.taskAssigneeLabel}
            <select
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
          </label>
        </div>
        {/* Descripción: not in the approved mockup — a deliberate deviation,
            kept because the backlog explicitly asked for a write path. */}
        <label className="field">
          {l.taskDescriptionLabel}
          <textarea
            className="textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
          />
        </label>
        <div className="bar">
          <button type="button" onClick={onCancel} disabled={busy}>
            {l.cancel}
          </button>
          <button
            type="button"
            disabled={busy || !title.trim()}
            onClick={() =>
              title.trim() &&
              onSubmit(title.trim(), dueDate ? new Date(dueDate) : undefined, description.trim() || undefined, assignedToBdId)
            }
          >
            {l.taskCreate}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

interface EmailGenerateProps {
  labels: GenerateMessageLabels;
  boundAction: (
    prevState: GenerateOutreachMessageResult | null,
    formData: FormData,
  ) => Promise<GenerateOutreachMessageResult>;
  onGenerated: (message: string) => void;
}

function EmailForm({
  labels: l,
  to,
  busy,
  error,
  initialSubject,
  initialBody,
  generate,
  onCancel,
  onSubmit,
}: ComposerProps & {
  to: string | null;
  initialSubject?: string | null;
  initialBody?: string | null;
  // "Generar mensaje" (task 13.3) — omitted entirely (rather than rendered
  // disabled) when the caller has nothing to bind, keeping this composer
  // reusable for a context with no AI draft (none today, but no reason to
  // hard-couple the two).
  generate?: EmailGenerateProps;
  onSubmit: (subject: string, body: string) => void;
}) {
  const [subject, setSubject] = useState(initialSubject ?? "");
  const [body, setBody] = useState(initialBody ?? "");

  if (!to) {
    return (
      <Dialog open onClose={onCancel} title={l.quickActionEmail}>
        <div className="composer">{l.emailNoAddress}</div>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onCancel} title={l.quickActionEmail} wide>
      <div className="composer">
        {error && <ErrorNotice labels={l} error={error} />}
        <label className="field">
          {l.emailToLabel}
          <input className="input" value={to} disabled />
        </label>
        <label className="field">
          {l.emailSubjectLabel}
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={busy} />
        </label>
        <label className="field">
          {l.emailBodyLabel}
          <textarea className="textarea" value={body} onChange={(e) => setBody(e.target.value)} disabled={busy} />
        </label>
        {generate && (
          <GenerateMessageButton
            boundAction={generate.boundAction}
            labels={generate.labels}
            onGenerated={(message) => {
              generate.onGenerated(message);
              // "Redactar con IA" here always uses this action's default
              // channel (email) — split the "Asunto: ...\n\n<body>"
              // combined draft back into the two separate fields.
              const split = splitEmailDraft(message);
              if (split.subject) setSubject(split.subject);
              setBody(split.subject ? split.body : message);
            }}
          />
        )}
        <div className="bar">
          <button type="button" onClick={onCancel} disabled={busy}>
            {l.cancel}
          </button>
          <button type="button" disabled={busy || !body.trim()} onClick={() => body.trim() && onSubmit(subject.trim(), body.trim())}>
            {l.emailSend}
          </button>
        </div>
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
  onSubmit: (
    outcome: string,
    direction: string,
    date: string,
    time: string,
    durationMinutes: string,
    notes: string,
  ) => void;
}) {
  const [outcome, setOutcome] = useState("");
  const [direction, setDirection] = useState<CallDirection>("outbound");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
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
    <Dialog open onClose={onCancel} title={l.callSubmit}>
      <div className="composer">
        {error && <ErrorNotice labels={l} error={error} />}
        <label className="field">
          {l.callOutcomeLabel}
          <select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)} disabled={busy}>
            <option value="">{l.callOutcomePlaceholder}</option>
            {CALL_OUTCOME_CODES.map((code) => (
              <option key={code} value={code}>
                {l[CALL_OUTCOME_LABEL_KEY[code]] as string}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {l.callDirectionLabel}
          <select
            className="input"
            value={direction}
            onChange={(e) => setDirection(e.target.value as CallDirection)}
            disabled={busy}
          >
            {CALL_DIRECTIONS.map((code) => (
              <option key={code} value={code}>
                {l[CALL_DIRECTION_LABEL_KEY[code]] as string}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {l.callDateLabel}
          <input
            className="input"
            type="date"
            value={date}
            max={dateMax}
            onChange={(e) => setDate(e.target.value)}
            disabled={busy}
          />
          <input
            className="input"
            type="time"
            value={time}
            max={timeMax}
            onChange={(e) => setTime(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="field">
          {l.callDurationLabel}
          <input
            className="input"
            type="number"
            min={0}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="field">
          {l.callNotesLabel}
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} />
        </label>
        <p className="hint">{l.callHelp}</p>
        <div className="bar">
          <button type="button" onClick={onCancel} disabled={busy}>
            {l.cancel}
          </button>
          <button
            type="button"
            disabled={busy || !outcome}
            onClick={() => outcome && onSubmit(outcome, direction, date, time, durationMinutes, notes)}
          >
            {l.callSubmit}
          </button>
        </div>
      </div>
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
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <Dialog open onClose={onCancel} title={l.meetingSubmit}>
      <div className="composer">
        {error && <ErrorNotice labels={l} error={error} />}
        <label className="field">
          {l.meetingDateLabel}
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
        </label>
        <label className="field">
          {l.meetingTimeLabel}
          <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={busy} />
        </label>
        <label className="field">
          {l.meetingNotesLabel}
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} />
        </label>
        <p className="hint">{l.meetingHelp}</p>
        <div className="bar">
          <button type="button" onClick={onCancel} disabled={busy}>
            {l.cancel}
          </button>
          <button type="button" disabled={busy || !date} onClick={() => date && onSubmit(date, time, notes)}>
            {l.meetingSubmit}
          </button>
        </div>
      </div>
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
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const requiresNote = reason === "other";

  return (
    <Dialog open onClose={onCancel} title={l.discardSubmit}>
      <div className="composer">
        {error && <ErrorNotice labels={l} error={error} />}
        <label className="field">
          {l.discardReasonLabel}
          <select className="input" value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy}>
            <option value="">{l.discardReasonPlaceholder}</option>
            {DISCARD_REASON_CODES.map((code) => (
              <option key={code} value={code}>
                {l[DISCARD_REASON_LABEL_KEY[code]] as string}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {l.discardNoteLabel}
          <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
        </label>
        {requiresNote && <p className="hint">{l.discardNoteRequiredHint}</p>}
        <div className="bar">
          <button type="button" onClick={onCancel} disabled={busy}>
            {l.cancel}
          </button>
          <button
            type="button"
            disabled={busy || !reason || (requiresNote && !note.trim())}
            onClick={() => onSubmit(reason || null, note)}
          >
            {l.discardSubmit}
          </button>
        </div>
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
        <button type="button" onClick={onCancel} disabled={busy}>
          {l.cancel}
        </button>
        <button type="button" onClick={() => text.trim() && onSubmit(text.trim())} disabled={busy || !text.trim()}>
          {l.signalSave}
        </button>
      </div>
    </div>
  );
}

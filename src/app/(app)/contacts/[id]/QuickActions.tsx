"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { contactActionErrorMessage, type ContactRecordLabels } from "@/lib/contacts/labels";
import { contactActionErrorHref } from "../actionErrors";
import {
  addContactNoteAction,
  addContactSignalAction,
  addContactTaskAction,
  discardContactAction,
  logContactMeetingAction,
  sendContactEmailAction,
} from "../actions";
import { generatePersonOutreachMessageAction } from "../messageActions";
import { GenerateMessageButton } from "@/app/(app)/outreach/GenerateMessageButton";
import type { GenerateOutreachMessageResult } from "@/app/(app)/outreach/actions";
import type { GenerateMessageLabels } from "@/lib/outreach/messageLabels";
import type { Locale } from "@/lib/i18n/locales";
import { DISCARD_REASON_CODES, type DiscardReasonCode } from "@/lib/contacts/discard";
import styles from "./AboutPane.module.css";

export interface QuickActionsProps {
  personId: string;
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
}

type QuickAction = "note" | "email" | "task" | "meeting" | "discard" | "signal" | null;

const DISCARD_REASON_LABEL_KEY: Record<DiscardReasonCode, keyof ContactRecordLabels> = {
  wrong_profile: "discardReasonWrongProfile",
  not_interested: "discardReasonNotInterested",
  other_vendor: "discardReasonOtherVendor",
  left_company: "discardReasonLeftCompany",
  bad_data: "discardReasonBadData",
  other: "discardReasonOther",
};

interface ActionError {
  message: string;
  href?: string;
}

interface ComposerProps {
  labels: ContactRecordLabels;
  busy: boolean;
  error: ActionError | null;
  onCancel: () => void;
}

function ErrorNotice({ labels: l, error }: { labels: ContactRecordLabels; error: ActionError }) {
  return (
    <div className={styles.error} role="alert">
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
  labels: l,
  email,
  messageLabels,
  locale,
  initialAction,
}: QuickActionsProps) {
  const router = useRouter();
  const [openAction, setOpenAction] = useState<QuickAction>(initialAction ?? null);
  const [error, setError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);
  // Filled by "Generar mensaje" (see the EmailForm render below) — kept
  // here (not inside EmailForm's own state) so a fresh generation before
  // the email panel is opened still has somewhere to land.
  const [generatedBody, setGeneratedBody] = useState<string | null>(null);

  function closeQuickAction() {
    setOpenAction(null);
    setError(null);
  }

  function toggle(action: QuickAction) {
    setOpenAction(openAction === action ? null : action);
  }

  return (
    <>
      <div className={styles.quickActions} role="toolbar" aria-label={l.aboutSectionTitle}>
        <button type="button" className={styles.qa} onClick={() => toggle("note")}>
          {l.quickActionNote}
        </button>
        <button type="button" className={styles.qa} onClick={() => toggle("email")}>
          {l.quickActionEmail}
        </button>
        <button type="button" className={styles.qa} onClick={() => toggle("task")}>
          {l.quickActionTask}
        </button>
        <button type="button" className={styles.qa} onClick={() => toggle("meeting")}>
          {l.quickActionMeeting}
        </button>
        <button type="button" className={styles.qa} onClick={() => toggle("discard")}>
          {l.quickActionDiscard}
        </button>
        <button type="button" className={styles.qa} onClick={() => toggle("signal")}>
          {l.quickActionSignal}
        </button>
      </div>

      {openAction === "note" && (
        <NoteForm
          labels={l}
          busy={busy}
          error={error}
          onCancel={closeQuickAction}
          onSubmit={async (note) => {
            setBusy(true);
            setError(null);
            const result = await addContactNoteAction(personId, note);
            setBusy(false);
            if (result.ok) {
              closeQuickAction();
              router.refresh();
            } else {
              setError({
                message: contactActionErrorMessage(l, result.reason),
                href: contactActionErrorHref(result.reason),
              });
            }
          }}
        />
      )}

      {openAction === "task" && (
        <TaskForm
          labels={l}
          busy={busy}
          error={error}
          onCancel={closeQuickAction}
          onSubmit={async (title, dueAt) => {
            setBusy(true);
            setError(null);
            const result = await addContactTaskAction(personId, title, dueAt);
            setBusy(false);
            if (result.ok) {
              closeQuickAction();
              router.refresh();
            } else {
              setError({
                message: contactActionErrorMessage(l, result.reason),
                href: contactActionErrorHref(result.reason),
              });
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
              router.refresh();
            } else {
              setError({
                message: contactActionErrorMessage(l, result.reason),
                href: contactActionErrorHref(result.reason),
              });
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
              router.refresh();
            } else {
              setError({ message: contactActionErrorMessage(l, result.reason) });
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
              router.refresh();
            } else {
              setError({ message: contactActionErrorMessage(l, result.reason) });
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
              router.refresh();
            } else {
              setError({ message: contactActionErrorMessage(l, result.reason) });
            }
          }}
        />
      )}
    </>
  );
}

function NoteForm({
  labels: l,
  busy,
  error,
  onCancel,
  onSubmit,
}: ComposerProps & { onSubmit: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <div className={styles.composer}>
      {error && <ErrorNotice labels={l} error={error} />}
      <textarea
        className={styles.textarea}
        placeholder={l.notePlaceholder}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={busy}
      />
      <div className={styles.composerBar}>
        <button type="button" onClick={onCancel} disabled={busy}>
          {l.cancel}
        </button>
        <button type="button" onClick={() => note.trim() && onSubmit(note.trim())} disabled={busy || !note.trim()}>
          {l.noteSave}
        </button>
      </div>
    </div>
  );
}

function TaskForm({
  labels: l,
  busy,
  error,
  onCancel,
  onSubmit,
}: ComposerProps & { onSubmit: (title: string, dueAt?: Date) => void }) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  return (
    <div className={styles.composer}>
      {error && <ErrorNotice labels={l} error={error} />}
      <label className={styles.label}>
        {l.taskTitleLabel}
        <input className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
      </label>
      <label className={styles.label}>
        {l.taskDueLabel}
        <input
          className={styles.input}
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          disabled={busy}
        />
      </label>
      <div className={styles.composerBar}>
        <button type="button" onClick={onCancel} disabled={busy}>
          {l.cancel}
        </button>
        <button type="button" disabled={busy || !title.trim()} onClick={() => title.trim() && onSubmit(title.trim(), dueDate ? new Date(dueDate) : undefined)}>
          {l.taskCreate}
        </button>
      </div>
    </div>
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
  initialBody,
  generate,
  onCancel,
  onSubmit,
}: ComposerProps & {
  to: string | null;
  initialBody?: string | null;
  // "Generar mensaje" (task 13.3) — omitted entirely (rather than rendered
  // disabled) when the caller has nothing to bind, keeping this composer
  // reusable for a context with no AI draft (none today, but no reason to
  // hard-couple the two).
  generate?: EmailGenerateProps;
  onSubmit: (subject: string, body: string) => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState(initialBody ?? "");

  if (!to) {
    return <div className={styles.composer}>{l.emailNoAddress}</div>;
  }

  return (
    <div className={styles.composer}>
      {error && <ErrorNotice labels={l} error={error} />}
      <label className={styles.label}>
        {l.emailToLabel}
        <input className={styles.input} value={to} disabled />
      </label>
      <label className={styles.label}>
        {l.emailSubjectLabel}
        <input className={styles.input} value={subject} onChange={(e) => setSubject(e.target.value)} disabled={busy} />
      </label>
      <label className={styles.label}>
        {l.emailBodyLabel}
        <textarea className={styles.textarea} value={body} onChange={(e) => setBody(e.target.value)} disabled={busy} />
      </label>
      {generate && (
        <GenerateMessageButton
          boundAction={generate.boundAction}
          labels={generate.labels}
          onGenerated={(message) => {
            generate.onGenerated(message);
            setBody(message);
          }}
        />
      )}
      <div className={styles.composerBar}>
        <button type="button" onClick={onCancel} disabled={busy}>
          {l.cancel}
        </button>
        <button type="button" disabled={busy || !body.trim()} onClick={() => body.trim() && onSubmit(subject.trim(), body.trim())}>
          {l.emailSend}
        </button>
      </div>
    </div>
  );
}

function MeetingForm({
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
    <div className={styles.composer}>
      {error && <ErrorNotice labels={l} error={error} />}
      <label className={styles.label}>
        {l.meetingDateLabel}
        <input className={styles.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
      </label>
      <label className={styles.label}>
        {l.meetingTimeLabel}
        <input className={styles.input} type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={busy} />
      </label>
      <label className={styles.label}>
        {l.meetingNotesLabel}
        <textarea className={styles.textarea} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} />
      </label>
      <p className={styles.hint}>{l.meetingHelp}</p>
      <div className={styles.composerBar}>
        <button type="button" onClick={onCancel} disabled={busy}>
          {l.cancel}
        </button>
        <button type="button" disabled={busy || !date} onClick={() => date && onSubmit(date, time, notes)}>
          {l.meetingSubmit}
        </button>
      </div>
    </div>
  );
}

function DiscardForm({
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
    <div className={styles.composer}>
      {error && <ErrorNotice labels={l} error={error} />}
      <label className={styles.label}>
        {l.discardReasonLabel}
        <select className={styles.input} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy}>
          <option value="">{l.discardReasonPlaceholder}</option>
          {DISCARD_REASON_CODES.map((code) => (
            <option key={code} value={code}>
              {l[DISCARD_REASON_LABEL_KEY[code]] as string}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.label}>
        {l.discardNoteLabel}
        <textarea className={styles.textarea} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
      </label>
      {requiresNote && <p className={styles.hint}>{l.discardNoteRequiredHint}</p>}
      <div className={styles.composerBar}>
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
    <div className={styles.composer}>
      {error && <ErrorNotice labels={l} error={error} />}
      <textarea
        className={styles.textarea}
        placeholder={l.signalPlaceholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
      />
      <div className={styles.composerBar}>
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

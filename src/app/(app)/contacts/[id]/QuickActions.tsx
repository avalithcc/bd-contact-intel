"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { contactActionErrorMessage, type ContactRecordLabels } from "@/lib/contacts/labels";
import { addContactNoteAction, addContactTaskAction, sendContactEmailAction } from "../actions";
import styles from "./AboutPane.module.css";

export interface QuickActionsProps {
  personId: string;
  labels: ContactRecordLabels;
  email: string | null;
}

type QuickAction = "note" | "email" | "task" | null;

interface ComposerProps {
  labels: ContactRecordLabels;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
}

/**
 * Quick actions row (task 9.2): Nota/Correo/Tarea wired; Reunión/Descartar
 * render-only placeholders for Phase 10.
 */
export function QuickActions({ personId, labels: l, email }: QuickActionsProps) {
  const router = useRouter();
  const [openAction, setOpenAction] = useState<QuickAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        <button type="button" className={styles.qaDisabled} disabled title={l.comingSoonPhase10}>
          {l.quickActionMeeting}
        </button>
        <button type="button" className={styles.qaDisabled} disabled title={l.comingSoonPhase10}>
          {l.quickActionDiscard}
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
              setError(contactActionErrorMessage(l, result.reason));
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
              setError(contactActionErrorMessage(l, result.reason));
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
              setError(contactActionErrorMessage(l, result.reason));
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
      {error && <div className={styles.error}>{error}</div>}
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
      {error && <div className={styles.error}>{error}</div>}
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

function EmailForm({
  labels: l,
  to,
  busy,
  error,
  onCancel,
  onSubmit,
}: ComposerProps & { to: string | null; onSubmit: (subject: string, body: string) => void }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  if (!to) {
    return <div className={styles.composer}>{l.emailNoAddress}</div>;
  }

  return (
    <div className={styles.composer}>
      {error && <div className={styles.error}>{error}</div>}
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

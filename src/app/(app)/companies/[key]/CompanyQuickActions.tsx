"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/Dialog";
import { useToast } from "@/components/ToastProvider";
import { NoteIcon, TasksIcon, MeetingIcon, ContactsIcon } from "@/components/icons";
import { NewContactDialog, type NewContactDialogLabels } from "@/app/(app)/contacts/NewContactDialog";
import type { ClientStrings } from "@/lib/i18n/clientStrings";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import {
  addCompanyNoteAction,
  addCompanyTaskAction,
  logCompanyMeetingAction,
} from "../actions";

// ClientStrings-wrapped (see src/lib/companies/labels.ts's doc comment): a
// Pick<...> straight off `Dictionary["companyRecord"]` fails to compile if
// any of these keys is ever turned into a formatter function.
export type CompanyQuickActionsLabels = ClientStrings<
  Pick<
    Dictionary["companyRecord"],
    | "quickActionNote"
    | "quickActionTask"
    | "quickActionContact"
    | "quickActionMeeting"
    | "quickActionMore"
    | "moreComingSoon"
    | "cancel"
    | "save"
    | "genericError"
    | "noteDialogTitle"
    | "noteLabel"
    | "noteSave"
    | "taskDialogTitle"
    | "taskTitleLabel"
    | "taskDueLabel"
    | "taskCreate"
    | "meetingDialogTitle"
    | "meetingDateLabel"
    | "meetingTimeLabel"
    | "meetingNotesLabel"
    | "meetingSubmit"
    | "toastNoteSaved"
    | "toastTaskCreated"
    | "toastMeetingLogged"
  >
>;

type OpenAction = "note" | "task" | "contact" | "meeting" | null;

/**
 * Company-scoped quick actions row (mockup-port c03; company-record.html:66
 * — Nota/Tarea/Contacto/Reunión/Más). Nota and Tarea write through
 * `createActivityAction`/`createTaskAction`'s existing `companyKey`
 * parameter (no core change needed — see companies/actions.ts's doc
 * comment). "Contacto" reuses the SAME `NewContactDialog` the `/contacts`
 * list uses, prefilled with this company's name. "Reunión" is the one new
 * wrapper (`logCompanyMeetingAction`) around the already subject-agnostic
 * `planMeeting`. "Más" has no destination in the approved mockup (its 5th
 * icon has no specified menu) — kept inert, flagged in the checklist as an
 * open item rather than invented.
 */
export function CompanyQuickActions({
  companyKey,
  companyName,
  labels: l,
  newContactLabels,
}: {
  companyKey: string;
  companyName: string;
  labels: CompanyQuickActionsLabels;
  newContactLabels: NewContactDialogLabels;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState<OpenAction>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(null);
    setError(null);
  }

  return (
    <>
      <div className="quick-actions" role="toolbar" aria-label={l.quickActionNote}>
        <button type="button" className="qa" onClick={() => setOpen("note")}>
          <span className="qa-icon">
            <NoteIcon className="icon" />
          </span>
          {l.quickActionNote}
        </button>
        <button type="button" className="qa" onClick={() => setOpen("task")}>
          <span className="qa-icon">
            <TasksIcon className="icon" />
          </span>
          {l.quickActionTask}
        </button>
        {/* mockup-port c05: styled to match the other 4 icon buttons
            (company-record.html:66 shows Contacto as a plain `.qa` icon,
            same as Nota/Tarea/Reunión/Más) instead of NewContactDialog's
            default `.btn.btn-primary` trigger. */}
        <NewContactDialog
          labels={newContactLabels}
          initialCompany={companyName}
          renderTrigger={(onClick) => (
            <button type="button" className="qa" onClick={onClick}>
              <span className="qa-icon">
                <ContactsIcon className="icon" />
              </span>
              {l.quickActionContact}
            </button>
          )}
        />
        <button type="button" className="qa" onClick={() => setOpen("meeting")}>
          <span className="qa-icon">
            <MeetingIcon className="icon" />
          </span>
          {l.quickActionMeeting}
        </button>
        {/* Mockup's 5th icon (company-record.html:66) has no specified menu —
            see company-record-checklist.md's "Still open" section. */}
        <button type="button" className="qa" disabled title={l.moreComingSoon}>
          <span className="qa-icon">⋯</span>
          {l.quickActionMore}
        </button>
      </div>

      {open === "note" && (
        <NoteForm
          l={l}
          busy={busy}
          error={error}
          onCancel={close}
          onSubmit={async (note) => {
            setBusy(true);
            setError(null);
            const result = await addCompanyNoteAction(companyKey, note);
            setBusy(false);
            if (result.ok) {
              close();
              showToast(l.toastNoteSaved);
              router.refresh();
            } else {
              setError(result.message ?? l.genericError);
            }
          }}
        />
      )}

      {open === "task" && (
        <TaskForm
          l={l}
          busy={busy}
          error={error}
          onCancel={close}
          onSubmit={async (title, dueAt) => {
            setBusy(true);
            setError(null);
            const result = await addCompanyTaskAction(companyKey, title, dueAt);
            setBusy(false);
            if (result.ok) {
              close();
              showToast(l.toastTaskCreated);
              router.refresh();
            } else {
              setError(result.message ?? l.genericError);
            }
          }}
        />
      )}

      {open === "meeting" && (
        <MeetingForm
          l={l}
          busy={busy}
          error={error}
          onCancel={close}
          onSubmit={async (date, time, notes) => {
            setBusy(true);
            setError(null);
            const result = await logCompanyMeetingAction(companyKey, date, time, notes);
            setBusy(false);
            if (result.ok) {
              close();
              showToast(l.toastMeetingLogged);
              router.refresh();
            } else {
              setError(result.message ?? l.genericError);
            }
          }}
        />
      )}
    </>
  );
}

interface FormShellProps {
  l: CompanyQuickActionsLabels;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
}

function NoteForm({ l, busy, error, onCancel, onSubmit }: FormShellProps & { onSubmit: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <Dialog open onClose={onCancel} title={l.noteDialogTitle}>
      <div className="composer">
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <label className="field">
          {l.noteLabel}
          <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} autoFocus />
        </label>
        <div className="bar">
          <button type="button" onClick={onCancel} disabled={busy}>
            {l.cancel}
          </button>
          <button type="button" disabled={busy || !note.trim()} onClick={() => note.trim() && onSubmit(note.trim())}>
            {l.noteSave}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function TaskForm({
  l,
  busy,
  error,
  onCancel,
  onSubmit,
}: FormShellProps & { onSubmit: (title: string, dueAt?: Date) => void }) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  return (
    <Dialog open onClose={onCancel} title={l.taskDialogTitle}>
      <div className="composer">
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <label className="field">
          {l.taskTitleLabel}
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} autoFocus />
        </label>
        <label className="field">
          {l.taskDueLabel}
          <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={busy} />
        </label>
        <div className="bar">
          <button type="button" onClick={onCancel} disabled={busy}>
            {l.cancel}
          </button>
          <button
            type="button"
            disabled={busy || !title.trim()}
            onClick={() => title.trim() && onSubmit(title.trim(), dueDate ? new Date(dueDate) : undefined)}
          >
            {l.taskCreate}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function MeetingForm({
  l,
  busy,
  error,
  onCancel,
  onSubmit,
}: FormShellProps & { onSubmit: (date: string, time: string, notes: string) => void }) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <Dialog open onClose={onCancel} title={l.meetingDialogTitle}>
      <div className="composer">
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <label className="field">
          {l.meetingDateLabel}
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} autoFocus />
        </label>
        <label className="field">
          {l.meetingTimeLabel}
          <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={busy} />
        </label>
        <label className="field">
          {l.meetingNotesLabel}
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} />
        </label>
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

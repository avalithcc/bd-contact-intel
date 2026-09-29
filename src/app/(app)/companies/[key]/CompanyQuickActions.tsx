"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/Dialog";
import { useToast } from "@/components/ToastProvider";
import { NoteIcon, TasksIcon, MeetingIcon, ContactsIcon } from "@/components/icons";
import { NewContactDialog, type NewContactDialogLabels } from "@/app/(app)/contacts/NewContactDialog";
import { buildTaskAssigneeOptions } from "@/lib/tasks/assignee";
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
    | "taskDescriptionLabel"
    | "taskDueLabel"
    | "taskAssigneeLabel"
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
export interface TaskAssigneeOption {
  id: string;
  name: string;
}

export function CompanyQuickActions({
  companyKey,
  companyName,
  labels: l,
  newContactLabels,
  assigneeOptions,
  meId,
  ownerBdId,
}: {
  companyKey: string;
  companyName: string;
  labels: CompanyQuickActionsLabels;
  newContactLabels: NewContactDialogLabels;
  assigneeOptions: TaskAssigneeOption[];
  // Current BD's id (preselects "Asignado a", marks that option "(yo)") and
  // this Company's own owner (marks their option "(responsable)" — already
  // loaded on the record page, never fetched here — see buildTaskAssigneeOptions).
  meId: string;
  ownerBdId: string | null;
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
          assigneeOptions={assigneeOptions}
          meId={meId}
          ownerBdId={ownerBdId}
          onCancel={close}
          onSubmit={async (title, dueAt, description, assignedToBdId) => {
            setBusy(true);
            setError(null);
            const result = await addCompanyTaskAction(companyKey, title, dueAt, description, assignedToBdId);
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
  const ids = useId();
  const [note, setNote] = useState("");
  return (
    <Dialog
      open
      onClose={onCancel}
      title={l.noteDialogTitle}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            {l.cancel}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !note.trim()}
            onClick={() => note.trim() && onSubmit(note.trim())}
          >
            {l.noteSave}
          </button>
        </>
      }
    >
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="field">
        <label className="label" htmlFor={`${ids}-note`}>
          {l.noteLabel}
        </label>
        <textarea
          id={`${ids}-note`}
          className="textarea"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={busy}
          autoFocus
        />
      </div>
    </Dialog>
  );
}

function TaskForm({
  l,
  busy,
  error,
  assigneeOptions,
  meId,
  ownerBdId,
  onCancel,
  onSubmit,
}: FormShellProps & {
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
      title={l.taskDialogTitle}
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
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
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
          autoFocus
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

function MeetingForm({
  l,
  busy,
  error,
  onCancel,
  onSubmit,
}: FormShellProps & { onSubmit: (date: string, time: string, notes: string) => void }) {
  const ids = useId();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <Dialog
      open
      onClose={onCancel}
      title={l.meetingDialogTitle}
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
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {/* Fecha + Hora side by side (approved mockup contact-record.html
          #meeting's `.form-grid`) — mirrored here since this dialog has no
          mockup of its own. */}
      <div className="form-grid">
        <div className="field">
          <label className="label" htmlFor={`${ids}-date`}>
            {l.meetingDateLabel}
          </label>
          <input
            id={`${ids}-date`}
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={busy}
            autoFocus
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
    </Dialog>
  );
}

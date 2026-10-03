"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { contactActionErrorMessage, type ContactRecordLabels } from "@/lib/contacts/labels";
import { useToast } from "@/components/ToastProvider";
import { TasksIcon } from "@/components/icons";
import { saveNoteWithFollowUp } from "@/lib/contacts/actionOutcome";
import { addContactNoteAction, addContactTaskAction } from "../actions";

/**
 * The Actividad tab's pinned note composer (mockup-port r03; contact-
 * record.html:104-105 `#log-note`, permanently visible above the timeline —
 * NOT behind the "Nota" quick action toggle like the old placeholder was).
 * The "Nota" quick action (QuickActions.tsx) is now a plain `#log-note`
 * anchor that scrolls/focuses here, matching the mockup's own href.
 *
 * "Agregar tarea de seguimiento" (contact-record.html:105) has no visible
 * sub-fields in the static mockup beyond the button itself — reveals a
 * single title input and reuses the EXISTING `addContactTaskAction` (same
 * action the "Tarea" quick action uses), created with no due date, right
 * after the note saves. Documented interpretation, not a spec'd flow.
 *
 * The note and the task are two separate writes, so partial success is a
 * real state and is reported honestly (saveNoteWithFollowUp): the note is
 * cleared once saved, the follow-up can be retried alone, and "Nota
 * guardada." is only shown when everything asked for was saved.
 */
export function NoteComposer({ personId, labels: l }: { personId: string; labels: ContactRecordLabels }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [note, setNote] = useState("");
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpTitle, setFollowUpTitle] = useState("");
  const [busy, setBusy] = useState(false);
  // True once the note is written but its follow-up task is not: the next
  // save retries only the task.
  const [noteSaved, setNoteSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    // Retrying after a partial success: the note is already written, so the
    // textarea is empty and only the follow-up is sent.
    if (!noteSaved && !note.trim()) return;
    setBusy(true);
    setError(null);
    const outcome = await saveNoteWithFollowUp({
      noteAlreadySaved: noteSaved,
      followUpTitle: followUpOpen ? followUpTitle : "",
      saveNote: () => addContactNoteAction(personId, note.trim()),
      saveFollowUp: (title) => addContactTaskAction(personId, title),
    });
    setBusy(false);

    if (outcome.kind === "note_failed") {
      // Nothing was confirmed: keep the text so she can retry.
      const message = contactActionErrorMessage(l, outcome.reason);
      setError(message);
      showToast(message, "error");
      return;
    }

    // From here on the note IS written. Clear it (and refresh the timeline)
    // so a retry can never duplicate it, even when the follow-up failed.
    setNote("");
    router.refresh();

    if (outcome.kind === "follow_up_failed") {
      setNoteSaved(true);
      const message =
        outcome.reason === "unconfirmed"
          ? l.noteSavedFollowUpUnconfirmed
          : `${l.noteSavedFollowUpFailed} ${contactActionErrorMessage(l, outcome.reason)}`;
      setError(message);
      showToast(message, "error");
      return;
    }

    setNoteSaved(false);
    setFollowUpOpen(false);
    setFollowUpTitle("");
    showToast(l.toastNoteSaved);
  }

  function toggleFollowUp() {
    // Closing the follow-up after a partial success abandons it: the note
    // is saved, there is nothing left to retry.
    if (followUpOpen && noteSaved) {
      setNoteSaved(false);
      setFollowUpTitle("");
      setError(null);
    }
    setFollowUpOpen((v) => !v);
  }

  return (
    <div className="composer" id="log-note">
      <label className="sr-only" htmlFor="note-in">
        {l.notePlaceholder}
      </label>
      <textarea
        id="note-in"
        placeholder={l.notePlaceholder}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={busy || noteSaved}
      />
      {error && (
        <div className="error-text" role="alert">
          {error}
        </div>
      )}
      {followUpOpen && (
        <div className="field" style={{ padding: "0 var(--space-md)" }}>
          <input
            className="input"
            placeholder={l.addFollowUpTask}
            value={followUpTitle}
            onChange={(e) => setFollowUpTitle(e.target.value)}
            disabled={busy}
          />
        </div>
      )}
      <div className="bar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={toggleFollowUp} disabled={busy}>
          <TasksIcon className="icon" />
          {l.addFollowUpTask}
        </button>
        <span className="grow" />
        <button type="button" className="btn btn-primary btn-sm" onClick={handleSave} disabled={busy || (noteSaved ? !followUpTitle.trim() : !note.trim())}>
          {noteSaved ? l.followUpRetry : l.noteSave}
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { contactActionErrorMessage, type ContactRecordLabels } from "@/lib/contacts/labels";
import { useToast } from "@/components/ToastProvider";
import { TasksIcon } from "@/components/icons";
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
 */
export function NoteComposer({ personId, labels: l }: { personId: string; labels: ContactRecordLabels }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [note, setNote] = useState("");
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpTitle, setFollowUpTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!note.trim()) return;
    setBusy(true);
    setError(null);
    const result = await addContactNoteAction(personId, note.trim());
    if (!result.ok) {
      setBusy(false);
      const message = contactActionErrorMessage(l, result.reason);
      setError(message);
      showToast(message, "error");
      return;
    }
    if (followUpOpen && followUpTitle.trim()) {
      await addContactTaskAction(personId, followUpTitle.trim());
    }
    setBusy(false);
    setNote("");
    setFollowUpOpen(false);
    setFollowUpTitle("");
    showToast(l.toastNoteSaved);
    router.refresh();
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
        disabled={busy}
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
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFollowUpOpen((v) => !v)} disabled={busy}>
          <TasksIcon className="icon" />
          {l.addFollowUpTask}
        </button>
        <span className="grow" />
        <button type="button" className="btn btn-primary btn-sm" onClick={handleSave} disabled={busy || !note.trim()}>
          {l.noteSave}
        </button>
      </div>
    </div>
  );
}

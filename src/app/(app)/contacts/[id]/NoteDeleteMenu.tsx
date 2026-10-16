"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/Dialog";
import { MoreIcon, WarningIcon } from "@/components/icons";
import { useToast } from "@/components/ToastProvider";
import { contactActionErrorMessage, type ContactRecordLabels } from "@/lib/contacts/labels";
import { deleteContactNoteAction } from "../actions";

/**
 * Per-item menu on a note's timeline card plus the confirmation it opens (contact-note-delete). The parent renders it only
 * when canDeleteNote says the viewer may; that is a courtesy, deleteContactNoteAction re-checks on the server. The copy says
 * the text stops being shown but the timeline records who deleted it: it never promises the note disappears.
 */
export function NoteDeleteMenu({ noteId, labels: l }: { noteId: string; labels: ContactRecordLabels }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const result = await deleteContactNoteAction(noteId);
      if (result.ok) {
        setOpen(false);
        showToast(l.toastNoteDeleted);
        router.refresh();
        return;
      }
      setError(contactActionErrorMessage(l, result.reason));
    } catch {
      // The request itself failed: whether the write landed is unknown, so say so instead of claiming either outcome.
      setError(contactActionErrorMessage(l, "unconfirmed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <details className="dropdown">
        <summary className="btn btn-ghost btn-sm btn-icon" aria-label={l.noteMenuLabel}>
          <MoreIcon className="icon" />
        </summary>
        <div className="menu">
          <button
            type="button"
            className="menu-item"
            onClick={(e) => {
              e.currentTarget.closest("details")?.removeAttribute("open");
              setOpen(true);
            }}
          >
            {l.noteDeleteAction}
          </button>
        </div>
      </details>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={l.noteDeleteDialogTitle}
        closeDisabled={busy}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={busy}>
              {l.noteDeleteCancel}
            </button>
            <button type="button" className="btn btn-danger" onClick={confirm} disabled={busy}>
              {l.noteDeleteAction}
            </button>
          </>
        }
      >
        <div className="stack">
          <div className="alert alert-warn">
            <WarningIcon className="icon" />
            <div>
              {l.noteDeleteWarningLead} <strong>{l.noteDeleteWarningEmphasis}</strong>
              {l.noteDeleteWarningTail}
            </div>
          </div>
          <p className="meta">{l.noteDeleteHint}</p>
          {error && (
            <span className="error-text" role="alert">
              {error}
            </span>
          )}
        </div>
      </Dialog>
    </>
  );
}

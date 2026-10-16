/**
 * Who may delete a Contact note (contact-note-delete decision 4): its author or an admin. A note is something a BD asserted,
 * not a shared work item, so another BD does not get to erase it. Pure and DB-free, so the view (to show the menu) and the
 * server (noteDeleteDb.ts, to enforce) read the SAME rule; hiding the menu is a courtesy, the server check is the control.
 */
import { isAdminRole } from "@/lib/auth/adminRole";

export interface NoteForDelete {
  type: string;
  actorBdId: string | null;
  deletedAt: Date | null;
}

export function canDeleteNote(note: NoteForDelete, viewer: { id: string; role: string }): boolean {
  if (note.type !== "note" || note.deletedAt) return false;
  return isAdminRole(viewer) || (note.actorBdId !== null && note.actorBdId === viewer.id);
}

/**
 * The ONE place a deleted note's text is withheld. Both timelines (the Contact's buildTimelineEntry and the company's
 * buildCompanyTimelineEntry) pass their row's metadata through here, so a change cannot leak the body in one view and not the other.
 */
export function withholdDeletedMetadata<T>(metadata: T, deletedAt: Date | null | undefined): T | null {
  return deletedAt ? null : metadata;
}

/** Missing, not a Contact note, or already deleted: indistinguishable on purpose, none of them is the viewer's to act on. */
export class NoteNotFoundError extends Error {
  constructor() {
    super("Note not found");
    this.name = "NoteNotFoundError";
  }
}

export class NoteDeleteForbiddenError extends Error {
  constructor() {
    super("Only the author of a note or an admin may delete it");
    this.name = "NoteDeleteForbiddenError";
  }
}

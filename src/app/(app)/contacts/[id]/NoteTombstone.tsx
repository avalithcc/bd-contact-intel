import { NoteIcon } from "@/components/icons";
import type { ContactRecordLabels } from "@/lib/contacts/labels";

/** The only strings the tombstone needs, so the company view can supply them without the whole contact dictionary. */
export type NoteTombstoneLabels = Pick<ContactRecordLabels, "noteDeletedTitle" | "noteDeletedWrittenBy" | "noteDeletedDeletedBy" | "noteDeletedAdminSuffix" | "timelineSystemActor">;

/**
 * What a soft-deleted note leaves in the timeline (contact-note-delete decision 2): a muted `tl-card system` saying a note
 * existed, who WROTE it and who DELETED it and when. Never a gap: a timeline with silent holes rewrites history. It takes no
 * body at all, so there is nothing to leak; the text is already gone from the entry (buildTimelineEntry).
 * `deletedByAdmin` is the deleter's actual role (never inferred from author vs deleter ids, which breaks for imported notes and removed BDs).
 */
export function NoteTombstone({
  labels: l,
  authorName,
  deleterName,
  deletedByAdmin,
  writtenAtText,
  deletedAtText,
}: {
  labels: NoteTombstoneLabels;
  authorName: string | null;
  deleterName: string | null;
  deletedByAdmin: boolean;
  writtenAtText: string;
  deletedAtText: string;
}) {
  const unknown = l.timelineSystemActor;
  return (
    <div className="tl-item">
      <div className="tl-icon system">
        <NoteIcon className="icon" />
      </div>
      <div className="tl-card system">
        <div className="tl-head">
          <span className="what">{l.noteDeletedTitle}</span>
          <span className="when">{writtenAtText}</span>
        </div>
        <div className="tl-body">
          <span className="soft">
            {l.noteDeletedWrittenBy} {authorName ?? unknown} · {l.noteDeletedDeletedBy} {deleterName ?? unknown}
            {deletedByAdmin ? ` ${l.noteDeletedAdminSuffix}` : ""} {deletedAtText}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Pure visibility rule for the Contact record's timeline pane (task 10.1;
 * admin-access-audit spec "Non-admins cannot read other BDs' conversation
 * content"; contact-record spec "Conversation visibility on the record").
 *
 * Only `email_sent` carries per-BD conversation content among the activity
 * types this pane renders (task/note/hunter_lookup/status_change/
 * meeting_logged/discarded/status_backfill are team-shared record facts, not
 * a private conversation). An admin bypass with audited access
 * (`getConversationForAdmin`) is Phase 11 scope (task 11.3) — until that
 * ships, every viewer (including an admin) sees the same locked marker for
 * another BD's `email_sent` entry, never its `to`/`subject` metadata. This is
 * the conservative default: it can only under-reveal, never leak content
 * ahead of the audited access path.
 */

/** Activity types this pane can carry per-BD conversation content for. */
const CONVERSATION_CONTENT_TYPES = new Set(["email_sent"]);

export interface TimelineVisibilityInput {
  type: string;
  actorBdId: string | null;
}

export function isTimelineEntryVisible(entry: TimelineVisibilityInput, viewerBdId: string): boolean {
  if (!CONVERSATION_CONTENT_TYPES.has(entry.type)) return true;
  return entry.actorBdId === null || entry.actorBdId === viewerBdId;
}

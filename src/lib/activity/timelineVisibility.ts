/**
 * Pure visibility rule for the Contact record's timeline pane (task 10.1;
 * admin-access-audit spec "Non-admins cannot read other BDs' conversation
 * content"; contact-record spec "Conversation visibility on the record").
 *
 * `email_sent` and `reply_received` carry per-BD conversation content among
 * the activity types this pane renders (task/note/hunter_lookup/
 * status_change/meeting_logged/discarded/status_backfill are team-shared
 * record facts, not a private conversation). `reply_received` was added by
 * the email-sync brief (2026-09-30) — its metadata carries `matchedEmail`,
 * the counterpart address one specific BD's mailbox exchanged mail with, so
 * it gets the same per-BD scoping as `email_sent` rather than being treated
 * as a team-shared fact. An admin bypass with audited access
 * (`getConversationForAdmin`) is Phase 11 scope (task 11.3) — until that
 * ships, every viewer (including an admin) sees the same locked marker for
 * another BD's entry, never its metadata. This is the conservative default:
 * it can only under-reveal, never leak content ahead of the audited access
 * path.
 */

/** Activity types this pane can carry per-BD conversation content for. */
const CONVERSATION_CONTENT_TYPES = new Set(["email_sent", "reply_received"]);

export interface TimelineVisibilityInput {
  type: string;
  actorBdId: string | null;
}

export function isTimelineEntryVisible(entry: TimelineVisibilityInput, viewerBdId: string): boolean {
  if (!CONVERSATION_CONTENT_TYPES.has(entry.type)) return true;
  return entry.actorBdId === null || entry.actorBdId === viewerBdId;
}

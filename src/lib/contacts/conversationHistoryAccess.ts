/**
 * Pure decisions shared by the two surfaces that restore LinkedIn
 * conversation visibility on the contact record without a "LinkedIn" filter
 * pill (owner decision 2026-09-30): the right panel's "Historial de
 * conversaciones" card (page.tsx) and the interleaved "Todo" timeline
 * (Timeline.tsx). Both reuse `linkedinEntryAccess`
 * (@/lib/contacts/connectionTimelineEntries) for the underlying
 * own/admin-bypass/locked classification; this module adds the two bits
 * that classification alone doesn't answer.
 */
import {
  buildConnectionTimelineEntries,
  type ConnectionForTimeline,
  type LinkedinEntryAccess,
} from "@/lib/contacts/connectionTimelineEntries";

/**
 * Whether a synthesized LinkedIn timeline entry (contact-record.html:
 * 124-131's "Mensaje de LinkedIn enviado" / "Respuesta de LinkedIn
 * recibida" cards) must render the generic locked marker instead of its
 * own content.
 *
 * Deliberate collapse of `admin-bypass` into "locked" here: the old inline
 * `AdminConversationReveal` (removed 2026-09-28, file deleted 2026-09-30) is
 * NOT being restored in the timeline. An admin still gets an entry point —
 * the SAME locked-row "Ver conversación (queda registrado)" action
 * email_sent/reply_received rows use (admin-conversation-access,
 * `renderAdminViewAction` in Timeline.tsx) — but it now opens the shared
 * `ConversationDialog` (via `AdminConversationFlow`) instead of navigating to
 * a separate page. Only the connection's OWNING BD ever sees an unlocked
 * entry inline.
 */
export function isLinkedinEntryLocked(access: LinkedinEntryAccess): boolean {
  return access !== "own";
}

/**
 * The "Todo" pill's own count decision now that there is no dedicated
 * "LinkedIn" pill to hold it (owner decision 2026-09-30): one unit per
 * connection with real message history — the same "one synthesized entry
 * per connection" rule `buildConnectionTimelineEntries` already applies
 * (our schema only tracks per-connection aggregates, never a per-message
 * log across every BD) — NOT a raw per-message count. This keeps "Todo"'s
 * total exactly equal to how many LinkedIn entry cards would render if the
 * BD expanded every connection, the same invariant every other pill's own
 * count already holds against its own entries.
 */
export function linkedinTimelineTotal(connections: readonly ConnectionForTimeline[]): number {
  return buildConnectionTimelineEntries(connections).length;
}

export interface LockedConnectionCardRow {
  bdId: string;
  bdName: string | null;
}

/**
 * Every OTHER BD's LinkedIn connection with real message history, for the
 * right-rail "Historial de conversaciones" card's locked rows (bugfix
 * 2026-09-30: the card used to render NOTHING here for a non-admin, while
 * the interleaved "Todo" timeline already showed a locked marker for the
 * exact same connection via `isLinkedinEntryLocked` above — access-parity
 * spec, "non-admins MAY see which BDs have history... never the content").
 * Same underlying set `buildConnectionTimelineEntries` already computes for
 * the timeline — this just strips the viewer's own connection and the
 * timeline-specific fields, since the card only ever needs bdId/bdName.
 * Pure — the caller (page.tsx) attaches the count/date summary text and
 * decides whether an admin's row also gets the "Ver" action.
 */
export function resolveLockedConnectionCardRows(
  connections: readonly ConnectionForTimeline[],
  viewerBdId: string,
): LockedConnectionCardRow[] {
  return buildConnectionTimelineEntries(connections)
    .filter((e) => e.metadata.bdId !== viewerBdId)
    .map((e) => ({ bdId: e.metadata.bdId, bdName: e.metadata.bdName }));
}

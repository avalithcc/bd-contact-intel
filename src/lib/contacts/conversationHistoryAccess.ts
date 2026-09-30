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
 * `AdminConversationReveal` (removed 2026-09-28) is NOT being restored in
 * the timeline — an admin's audited bypass now only happens through the
 * dedicated `/contacts/[id]/conversation/[bdId]` page (linked from the
 * right panel card instead, see `conversationOfPrefix` usage in page.tsx).
 * Only the connection's OWNING BD ever sees an unlocked entry inline.
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

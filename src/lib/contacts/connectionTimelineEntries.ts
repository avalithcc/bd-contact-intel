/**
 * Synthesizes one timeline entry per BD connection with real message
 * history (mockup-port r04; contact-record.html:124-131's "Respuesta de
 * LinkedIn recibida" / "Mensaje de LinkedIn enviado" cards). Our schema only
 * tracks per-connection AGGREGATES (`person_bd_connection.sentCount` /
 * `receivedCount` / `lastMessageAt`), not a per-message log for every BD —
 * so this renders ONE card per connection (direction picked by "a reply
 * happened at all", the same signal-strength rule `deriveStatus` already
 * uses for connection-sourced status), not one card per individual message.
 * Pure — no DB, no dictionary; the caller resolves visibility/reveal UI.
 *
 * These entries are given the SAME shape `TimelineGroupingActivityEntry`
 * expects (id/type/createdAt/metadata) so they can be concatenated with real
 * `activity` rows and fed straight into the existing, already-tested
 * `groupTimelineEntries` (src/lib/contacts/timelineGrouping.ts) — no changes
 * needed there. `type` is a synthetic value ("linkedin_sent"/
 * "linkedin_replied") Timeline.tsx branches on for its own rendering; it is
 * never a real `TimelineActivityType` and never reaches the DB.
 */
export interface ConnectionForTimeline {
  bdId: string;
  bdName: string | null;
  sentCount: number;
  receivedCount: number;
  lastMessageAt: Date | null;
}

export type LinkedinTimelineEntryType = "linkedin_sent" | "linkedin_replied";

export interface LinkedinTimelineEntry {
  id: string;
  type: LinkedinTimelineEntryType;
  createdAt: Date;
  metadata: { bdId: string; bdName: string | null };
}

export function buildConnectionTimelineEntries(
  connections: readonly ConnectionForTimeline[],
): LinkedinTimelineEntry[] {
  return connections
    .filter((c) => c.lastMessageAt !== null && (c.sentCount > 0 || c.receivedCount > 0))
    .map((c) => ({
      id: `connection-${c.bdId}`,
      type: c.receivedCount > 0 ? ("linkedin_replied" as const) : ("linkedin_sent" as const),
      createdAt: c.lastMessageAt!,
      metadata: { bdId: c.bdId, bdName: c.bdName },
    }));
}

/**
 * Who may see this connection's REAL conversation content (mockup-port r04;
 * admin-access-audit spec "Admins can always read any BD's conversations",
 * "Non-admins cannot read other BDs' conversation content" — extended here
 * to also let a BD see their OWN connection's summary without the admin
 * bypass, since that isn't someone else's private conversation).
 */
export type LinkedinEntryAccess = "own" | "admin-bypass" | "locked";

export function linkedinEntryAccess(
  entryBdId: string,
  viewerBdId: string,
  viewerIsAdmin: boolean,
): LinkedinEntryAccess {
  if (entryBdId === viewerBdId) return "own";
  if (viewerIsAdmin) return "admin-bypass";
  return "locked";
}

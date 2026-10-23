/**
 * Whether a lone (ungrouped) email row gets the "Ver mensaje" button.
 *
 * `groupEmailThreads` deliberately leaves a one-message thread as a plain row,
 * and only the viewer's OWN mail was missing a way to read its body: an admin
 * already sees another BD's lone body inline (shipped with the page), so that
 * case must not also get a button.
 */
const CONVERSATION_TYPES = new Set(["email_sent", "reply_received", "auto_reply_received"]);

export interface LoneEmailRow {
  type: string;
  actorBdId?: string | null;
  visible: boolean;
  metadata: Record<string, unknown> | null;
}

export function loneEmailThreadId(row: LoneEmailRow): string | null {
  const id = row.metadata?.gmailThreadId;
  return typeof id === "string" && id ? id : null;
}

export function loneEmailMessageId(row: LoneEmailRow): string | null {
  const id = row.metadata?.gmailMessageId;
  return typeof id === "string" && id ? id : null;
}

export function canExpandLoneEmailBody(row: LoneEmailRow, viewer: { id: string }): boolean {
  if (!row.visible || !CONVERSATION_TYPES.has(row.type)) return false;
  if (!loneEmailThreadId(row) || !loneEmailMessageId(row)) return false;
  // Own mail only. Foreign mail an admin can see renders its body inline
  // (renderForeignMailBody), and the on-demand read is scoped to the viewer's
  // own mailbox, so it would come back empty for anyone else's.
  return row.actorBdId === viewer.id;
}

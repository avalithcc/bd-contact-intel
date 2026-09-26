/**
 * Pure summary of a connected BD's conversation history for the Contact
 * record's associations pane (task 11.1; contact-record spec "Associations").
 *
 * Deliberately carries only counts/dates, never message content — this is
 * the non-admin-safe summary admin-access-audit requires ("Non-admins ... MAY
 * see which BDs have history with a Contact, never the content", task 11.2).
 * Every viewer, admin or not, gets this same summary on the associations
 * pane; only the audited admin bypass (getConversationForAdmin, task 11.3)
 * reveals actual message content.
 */

export interface ConnectionHistoryInput {
  messageCount: number;
  lastMessageAt: Date | null;
}

export type ConnectionHistorySummary =
  | { kind: "none" }
  | { kind: "some"; count: number; lastMessageAt: Date | null };

export function describeConnectionHistory(input: ConnectionHistoryInput): ConnectionHistorySummary {
  if (input.messageCount <= 0) return { kind: "none" };
  return { kind: "some", count: input.messageCount, lastMessageAt: input.lastMessageAt };
}

/**
 * Pure board-view helpers (task 14.1; mockups/contacts-board.html;
 * design R4 "status is derived"). The board groups Contacts by
 * `person.status` into fixed columns and never writes status directly —
 * dragging (or the keyboard "Mover a..." menu) a card onto a column opens
 * the record page's matching quick-action composer instead (task 10.5),
 * which then writes the activity that `deriveStatus()` reads.
 *
 * Only `contacted` (email_sent), `meeting` (meeting_logged) and
 * `discarded` (discarded) have a quick action a BD can trigger manually
 * today. `new` has no "un-log" action, and `replied` only comes from an
 * inbound message/connection signal (`reply_received` is reserved for
 * email sync, design.md "New activity types") — there is no manual
 * "log a reply" action yet, so dropping on either column is a documented
 * no-op rather than silently mapping to an unrelated action.
 */
import type { PersonStatus } from "@/lib/status/deriveStatus";

export const BOARD_COLUMNS: readonly PersonStatus[] = [
  "new",
  "contacted",
  "replied",
  "meeting",
  "discarded",
] as const;

const BOARD_STATUS_SET: ReadonlySet<string> = new Set(BOARD_COLUMNS);

export function isBoardStatus(value: string): value is PersonStatus {
  return BOARD_STATUS_SET.has(value);
}

/** The `QuickActions` composer a drop on this column's target should open, or `null` if unsupported. */
export type BoardDropAction = "email" | "meeting" | "discard";

const DROP_ACTION_BY_STATUS: Partial<Record<PersonStatus, BoardDropAction>> = {
  contacted: "email",
  meeting: "meeting",
  discarded: "discard",
};

export function boardDropAction(status: PersonStatus): BoardDropAction | null {
  return DROP_ACTION_BY_STATUS[status] ?? null;
}

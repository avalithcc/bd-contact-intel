/**
 * Pure planning for the `status_change` activity `updateLeadStatus` appends
 * on a status edit (design "Reference writes" addendum: "`updateLeadStatus`
 * appends a `status_change` activity carrying `person_id`"; task 4B.6).
 */
import type { LeadStatusKey } from "./types";

export interface StatusChangeMetadata {
  status: LeadStatusKey;
}

/**
 * Only a real status edit produces an activity — a notes-only
 * `updateLeadStatus` call (or an invalid/absent status) must not fabricate
 * status history.
 */
export function planStatusChangeActivity(fields: {
  status?: LeadStatusKey;
}): StatusChangeMetadata | null {
  return fields.status ? { status: fields.status } : null;
}

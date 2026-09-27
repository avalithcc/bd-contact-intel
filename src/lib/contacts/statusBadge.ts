/**
 * Maps a `person.status` value to the mockup's status badge class
 * (mockup-port r02; design-system.css `.badge-new`/`.badge-contacted`/
 * `.badge-replied`/`.badge-meeting`/`.badge-discarded` — same vocabulary as
 * `leadStatuses` in the dictionary). Pure — no DB, no dictionary lookup.
 */
import type { PersonStatus } from "@/lib/status/deriveStatus";

export function statusBadgeClass(status: string): string {
  const known: readonly PersonStatus[] = ["new", "contacted", "replied", "meeting", "discarded"];
  return known.includes(status as PersonStatus) ? `badge badge-${status}` : "badge badge-neutral";
}

/**
 * Pure per-activity-type timeline body formatting (contact-record spec
 * "Filtered activity timeline"; hubspot-import spec "Discard evidence
 * preserves the historical date" — "Record page shows the discard reason
 * for an imported row"). Extracted from Timeline.tsx (a server component
 * that also imports @/lib/activity/queries's value exports, which touch
 * `@/db` and throw without DATABASE_URL) so this stays independently
 * unit-testable.
 *
 * A `status_backfill` activity with `metadata.status === 'discarded'`
 * shows its `reason` the SAME WAY a plain `discarded` activity does — the
 * migration writes discard evidence as a `status_backfill` row (not a
 * plain `discarded` row) to preserve the historical `originalAt`
 * (src/lib/hubspot/statusEvidence.ts), so the record page must recognize
 * both shapes, not just the plain one.
 */
import type { TimelineActivityType } from "@/lib/activity/queries";
import type { ContactRecordLabels } from "@/lib/contacts/labels";

export interface TimelineEntryForBody {
  type: string;
  visible: boolean;
  metadata: Record<string, unknown> | null;
}

function discardBody(metadata: Record<string, unknown>, l: ContactRecordLabels): string {
  const reason = typeof metadata.reason === "string" ? metadata.reason : null;
  const note = typeof metadata.note === "string" ? metadata.note : null;
  return [reason, note].filter(Boolean).join(" · ") || l.timelineDiscardedDefault;
}

export function entryBody(entry: TimelineEntryForBody, l: ContactRecordLabels): string {
  if (!entry.visible) return l.timelineLockedContent;
  const metadata = entry.metadata ?? {};
  switch (entry.type as TimelineActivityType) {
    case "note":
      return typeof metadata.note === "string" ? metadata.note : "";
    case "email_sent":
      return typeof metadata.to === "string" ? `${l.timelineEmailSentPrefix} ${metadata.to}` : l.timelineEmailSentPrefix;
    case "hunter_lookup":
      return typeof metadata.hunterScore === "number"
        ? `${l.timelineHunterPrefix} · ${metadata.hunterScore}`
        : l.timelineHunterPrefix;
    case "status_change": {
      const status = typeof metadata.status === "string" ? metadata.status : null;
      const label = status ? (l.leadStatuses[status as keyof typeof l.leadStatuses] ?? status) : "";
      return `${l.timelineStatusChangedPrefix} ${label}`;
    }
    case "status_backfill": {
      const status = typeof metadata.status === "string" ? metadata.status : null;
      if (status === "discarded") return discardBody(metadata, l);
      const label = status ? (l.leadStatuses[status as keyof typeof l.leadStatuses] ?? status) : "";
      return `${l.timelineStatusBackfillPrefix} ${label}`;
    }
    case "meeting_logged":
      return typeof metadata.notes === "string" && metadata.notes ? metadata.notes : l.timelineMeetingLoggedDefault;
    case "discarded":
      return discardBody(metadata, l);
    default:
      return "";
  }
}

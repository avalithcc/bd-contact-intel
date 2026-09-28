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

const CALL_OUTCOME_LABEL_KEY: Record<string, keyof ContactRecordLabels> = {
  connected: "callOutcomeConnected",
  busy: "callOutcomeBusy",
  no_answer: "callOutcomeNoAnswer",
  voicemail: "callOutcomeVoicemail",
  wrong_number: "callOutcomeWrongNumber",
};

/**
 * "call" activity's `.tl-head` `.what` text (contact-record.html: "Llamada
 * saliente · Conectado") — direction + outcome, NOT the generic
 * `FILTER_LABEL_KEY[type] · actorName` composition every other type uses
 * (Timeline.tsx), since the direction/outcome pair IS the headline fact for
 * a call, same reasoning as the LinkedIn entries' own dedicated headline.
 */
export function callWhatLabel(metadata: Record<string, unknown>, l: ContactRecordLabels): string {
  const direction = metadata.direction === "inbound" ? l.timelineCallInboundPrefix : l.timelineCallOutboundPrefix;
  const outcome = typeof metadata.outcome === "string" ? metadata.outcome : null;
  const outcomeLabel = outcome && CALL_OUTCOME_LABEL_KEY[outcome] ? (l[CALL_OUTCOME_LABEL_KEY[outcome]] as string) : null;
  return outcomeLabel ? `${direction} · ${outcomeLabel}` : direction;
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
    case "call": {
      const durationMinutes = typeof metadata.durationMinutes === "number" ? metadata.durationMinutes : null;
      const notes = typeof metadata.notes === "string" && metadata.notes ? metadata.notes : null;
      const durationText = durationMinutes !== null ? `${l.timelineCallDurationPrefix} ${durationMinutes} min.` : null;
      return [durationText, notes].filter(Boolean).join(" ") || l.timelineCallDefault;
    }
    case "discarded":
      return discardBody(metadata, l);
    default:
      return "";
  }
}

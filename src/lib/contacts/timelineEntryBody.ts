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
import { taskActivityBody, type TaskActivityBodyLabels, type TaskActivityMetadata } from "@/lib/tasks/taskActivityBody";

function taskActivityBodyLabels(l: ContactRecordLabels): TaskActivityBodyLabels {
  return {
    fieldTitle: l.taskChangeFieldTitle,
    fieldDue: l.taskChangeFieldDue,
    fieldAssignee: l.taskChangeFieldAssignee,
    fieldDescription: l.taskChangeFieldDescription,
    createdPrefix: l.taskChangeCreatedPrefix,
    updatedPrefix: l.taskChangeUpdatedPrefix,
    completedPrefix: l.taskChangeCompletedPrefix,
    reopenedPrefix: l.taskChangeReopenedPrefix,
    unknownActor: l.taskChangeUnknownActor,
  };
}

export interface TimelineEntryForBody {
  type: string;
  visible: boolean;
  metadata: Record<string, unknown> | null;
  // Owner decision (2026-09-29): any BD may edit/complete/reopen any task,
  // so every task activity type's (ALL_TASK_ACTIVITY_TYPES) body text must name
  // WHO did it — see taskActivityBody's doc comment.
  actorName: string | null;
}

/**
 * `metadata.to` is a single string for a manually composed send
 * (src/app/(app)/contacts/actions.ts#sendContactEmailAction) but a
 * `string[]` for a synced thread message (src/lib/gmail/
 * buildSyncedActivities.ts's SyncedActivityMetadata always writes it as an
 * array, even for one recipient) — the one shared place both `entryBody`'s
 * `email_sent` case and Timeline.tsx's expanded-thread "para ..." line
 * normalize either shape, so there is exactly one code path for it.
 */
export function emailRecipientText(metadata: Record<string, unknown> | null | undefined): string | null {
  const to = metadata?.to;
  if (typeof to === "string") return to || null;
  if (Array.isArray(to)) {
    const addresses = to.filter((v): v is string => typeof v === "string" && v !== "");
    return addresses.length > 0 ? addresses.join(", ") : null;
  }
  return null;
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
    // Shows the subject next to the recipient, the same `subject · who` shape
    // `reply_received` below already uses. `send.ts` has always written
    // `metadata.subject`; it simply was not rendered, so an email a BD SENT
    // showed strictly less than one they received. The body is not here by
    // design — it lives in `email_message.body_text`. The send path writes that
    // row in the same transaction as this activity and sets
    // `metadata.emailMessageId` itself (src/lib/gmail/sentEmailQueries.ts); only
    // when that write was skipped does the Gmail sync backfill the pointer
    // later (src/lib/gmail/syncQueries.ts#writeSyncedMessages).
    case "email_sent": {
      const to = emailRecipientText(metadata);
      const subject = typeof metadata.subject === "string" && metadata.subject ? metadata.subject : null;
      const sentTo = to ? `${l.timelineEmailSentPrefix} ${to}` : l.timelineEmailSentPrefix;
      return subject ? `${sentTo} · ${subject}` : sentTo;
    }
    // Synced Gmail reply (email-sync brief) — same entry layout email_sent
    // uses, showing the subject and the sender address (metadata.from) from
    // src/lib/gmail/buildSyncedActivities.ts's metadata shape, never the
    // body (full-thread UI is a later slice, behind its own mockup).
    case "reply_received": {
      const subject = typeof metadata.subject === "string" ? metadata.subject : null;
      const from = typeof metadata.from === "string" ? metadata.from : null;
      const parts = [subject, from].filter((v): v is string => Boolean(v));
      return parts.length > 0 ? parts.join(" · ") : l.timelineReplyReceivedDefault;
    }
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
    case "task_created":
    case "task_updated":
    case "task_completed":
    case "task_reopened":
      return taskActivityBody(entry.type, metadata as TaskActivityMetadata, entry.actorName, taskActivityBodyLabels(l));
    default:
      return "";
  }
}

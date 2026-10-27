/**
 * Text of the three follow-up timeline rows (follow-up-expiry mockup timeline-baja-seguimiento.html). Pure: the Contact
 * record's Timeline.tsx renders what this returns. A BD's drop is a regular card (a person did it); the automatic drop and
 * the re-entry are dashed system cards, the same variant "Unificado a partir de N registros" uses.
 */
import type { ContactRecordLabels } from "@/lib/contacts/labels";
import { formatCycleDate, type FollowUpDropReason } from "@/lib/followUp/cycle";
import {
  FOLLOW_UP_DROPPED_TYPE,
  FOLLOW_UP_EXPIRED_TYPE,
  FOLLOW_UP_REENTERED_TYPE,
} from "@/lib/followUp/activityTypes";
import type { FollowUpRecordState } from "@/lib/followUp/recordState";
import { fillTemplate } from "@/lib/i18n/template";

export interface FollowUpEntryView {
  headline: string;
  body: string;
  system: boolean;
}

const REASON_LABEL_KEY = {
  not_now: "followUpReasonNotNow",
  other_bd: "followUpReasonOtherBd",
  no_response: "followUpReasonNoResponse",
  bad_contact: "followUpReasonBadContact",
  other: "followUpReasonOther",
} as const satisfies Record<FollowUpDropReason, keyof ContactRecordLabels>;

export function followUpReasonLabel(reason: unknown, l: ContactRecordLabels): string {
  return typeof reason === "string" && Object.hasOwn(REASON_LABEL_KEY, reason) ? l[REASON_LABEL_KEY[reason as keyof typeof REASON_LABEL_KEY]] : "";
}

function statusLabel(status: unknown, l: ContactRecordLabels): string {
  return typeof status === "string" ? (l.leadStatuses[status as keyof typeof l.leadStatuses] ?? status) : "";
}

export interface FollowUpPropertyView {
  value: string;
  tone: "neutral" | "warn";
  why: string;
}

/** The "Seguimiento" row of the contact record (value + the usual `why` line); null hides the row. */
export function followUpPropertyText(state: FollowUpRecordState, l: ContactRecordLabels): FollowUpPropertyView | null {
  if (!state) return null;
  switch (state.kind) {
    case "in_queue":
      return {
        value: fillTemplate(l.followUpPropInQueue, { date: formatCycleDate(state.since) }),
        tone: "neutral",
        why: fillTemplate(l.followUpWhyInQueue, { date: formatCycleDate(state.since) }),
      };
    case "overdue":
      return {
        value: l.followUpPropOverdue,
        tone: "warn",
        why: fillTemplate(l.followUpWhyOverdue, { date: formatCycleDate(state.since), expires: formatCycleDate(state.expiresOn) }),
      };
    case "out":
      return {
        value: l.followUpPropOut,
        tone: "neutral",
        why:
          state.by === "system"
            ? fillTemplate(l.followUpWhyOutSystem, { date: formatCycleDate(state.on) })
            : fillTemplate(l.followUpWhyOutBd, { date: formatCycleDate(state.on), reason: followUpReasonLabel(state.reason, l) }),
      };
  }
}

export function followUpEntryText(
  entry: { type: string; actorName: string | null; metadata: Record<string, unknown> | null },
  l: ContactRecordLabels,
): FollowUpEntryView | null {
  const m = entry.metadata ?? {};
  const status = statusLabel(m.status, l);
  switch (entry.type) {
    case FOLLOW_UP_DROPPED_TYPE: {
      const detail = typeof m.detail === "string" && m.detail ? `${m.detail}. ` : "";
      return {
        headline: fillTemplate(l.followUpDroppedHeadline, { bd: entry.actorName ?? "", reason: followUpReasonLabel(m.reason, l) }),
        body: detail + fillTemplate(l.followUpDroppedBody, { status }),
        system: false,
      };
    }
    case FOLLOW_UP_EXPIRED_TYPE:
      return {
        headline: l.followUpExpiredHeadline,
        body: fillTemplate(l.followUpExpiredBody, {
          date: typeof m.cycleStartedOn === "string" ? formatCycleDate(m.cycleStartedOn) : "",
          status,
        }),
        system: true,
      };
    case FOLLOW_UP_REENTERED_TYPE:
      return { headline: l.followUpReenteredHeadline, body: l.followUpReenteredBody, system: true };
    default:
      return null;
  }
}

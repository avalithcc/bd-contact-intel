/**
 * Dictionary slice for every meeting surface (the Reuniones page, the outcome dialog, the contact record's strip and
 * timeline cards, the "Registrar reunión" dialog). A flat record of strings so it can cross the server -> client boundary.
 */
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { ClientStrings } from "@/lib/i18n/clientStrings";
import type { MeetingOutcomeErrorReason } from "@/lib/meetings/outcome";
import type { MeetingStatus, MeetingView } from "@/lib/meetings/status";

export type MeetingLabels = ClientStrings<Dictionary["meetings"]>;

export function pickMeetingLabels(dict: Dictionary): MeetingLabels {
  return { ...dict.meetings };
}

export function meetingErrorMessage(l: MeetingLabels, reason: MeetingOutcomeErrorReason | "unexpected"): string {
  switch (reason) {
    case "meeting_not_found":
      return l.errNotFound;
    case "meeting_forbidden":
      return l.errForbidden;
    case "meeting_not_open":
      return l.errNotOpen;
    case "meeting_outcome_invalid":
      return l.errInvalid;
    case "meeting_outcome_too_early":
      return l.errTooEarly;
    case "meeting_new_time_required":
      return l.errNewTimeRequired;
    case "meeting_new_time_in_past":
      return l.errNewTimeInPast;
    case "meeting_follow_up_date_invalid":
      return l.errFollowUpDate;
    case "meeting_undo_unavailable":
      return l.errUndoUnavailable;
    default:
      return l.errGeneric;
  }
}

/** Badge text of a status as it reads on the page; a scheduled meeting whose time has passed is "Por confirmar". */
export function meetingStatusLabel(l: MeetingLabels, status: MeetingStatus | "pending"): string {
  switch (status) {
    case "pending":
      return l.statusPending;
    case "scheduled":
      return l.statusScheduled;
    case "held":
      return l.statusHeld;
    case "no_show":
      return l.statusNoShow;
    case "rescheduled":
      return l.statusRescheduled;
    case "cancelled":
      return l.statusCancelled;
  }
}

export function meetingTabLabels(l: MeetingLabels): Record<MeetingView, string> {
  return {
    pending: l.tabPending,
    scheduled: l.tabScheduled,
    held: l.tabHeld,
    no_show: l.tabNoShow,
    rescheduled: l.tabRescheduled,
    cancelled: l.tabCancelled,
  };
}

/** The badge class of a status (design-system `.badge-*`), per the mockup's summary table. */
export function meetingStatusBadgeClass(status: MeetingStatus | "pending"): string {
  switch (status) {
    case "pending":
      return "badge-warn";
    case "scheduled":
      return "badge-meeting";
    case "held":
      return "badge-success";
    case "no_show":
      return "badge-warn";
    case "rescheduled":
      return "badge-neutral";
    case "cancelled":
      return "badge-danger";
  }
}

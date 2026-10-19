/**
 * The vocabulary of the meeting lifecycle (meeting-outcomes). Pure: no I/O, importable from server and client code alike.
 *
 * `scheduled` is the only open state. "Por confirmar" is not a status of its own: it is a `scheduled` meeting whose time has
 * passed (see isPendingConfirmation in outcome.ts). The other four are final; a reschedule leaves the old row `rescheduled`
 * and opens a new `scheduled` one.
 */
export const MEETING_STATUSES = ["scheduled", "held", "no_show", "rescheduled", "cancelled"] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

/** The four answers the outcome dialog offers; they are the statuses a scheduled meeting can move to. */
export const OUTCOME_CHOICES = ["held", "no_show", "rescheduled", "cancelled"] as const;
export type OutcomeChoice = (typeof OUTCOME_CHOICES)[number];

export function isOutcomeChoice(value: string | undefined): value is OutcomeChoice {
  return OUTCOME_CHOICES.includes(value as OutcomeChoice);
}

/** The tabs of /reuniones, in display order. `pending` is "Por confirmar". */
export const MEETING_VIEWS = ["pending", "scheduled", "held", "no_show", "rescheduled", "cancelled"] as const;
export type MeetingView = (typeof MEETING_VIEWS)[number];

export function isMeetingView(value: string | undefined): value is MeetingView {
  return MEETING_VIEWS.includes(value as MeetingView);
}

/** The activity types the lifecycle writes (the held one is the long-standing `meeting_logged`). */
export const MEETING_ACTIVITY_TYPES = ["meeting_scheduled", "meeting_no_show", "meeting_cancelled", "meeting_rescheduled"] as const;

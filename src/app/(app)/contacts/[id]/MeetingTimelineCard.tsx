import { CheckIcon, ClockIcon } from "@/components/icons";
import type { ContactRecordLabels } from "@/lib/contacts/labels";
import type { TimelineEntry } from "@/lib/activity/timelineEntry";
import { fillTemplate } from "@/lib/i18n/template";
import { formatMeetingAbsolute } from "@/lib/meetings/when";

/** The timeline types this card draws; `meeting_logged` (Se hizo) keeps the long-standing type. */
export const MEETING_CARD_TYPES = ["meeting_logged", "meeting_no_show", "meeting_cancelled", "meeting_rescheduled"] as const;

export function isMeetingCardType(type: string): boolean {
  return (MEETING_CARD_TYPES as readonly string[]).includes(type);
}

function instant(value: unknown, fallback: Date): Date {
  const d = typeof value === "string" ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d : fallback;
}

/**
 * Timeline cards for a meeting that already has an outcome (meetings mockup s2/s5c): held keeps the filled icon and says
 * "Realizada"; a reschedule keeps the old date struck through with the new one; a no-show and a cancellation are told apart.
 * Pure markup, no hooks: dates are absolute so the server and the browser print the same text.
 */
export function MeetingTimelineCard({ entry, at, labels }: { entry: TimelineEntry; at: Date; labels: ContactRecordLabels }) {
  const m = labels.meetings;
  const meta = entry.metadata ?? {};
  const meetingAt = instant(meta.at, at);
  const reason = typeof meta.reason === "string" && meta.reason ? meta.reason : null;
  const notes = typeof meta.notes === "string" && meta.notes ? meta.notes : null;
  const actor = entry.actorName ? ` · ${entry.actorName}` : "";

  let iconClass = "system";
  let Icon = ClockIcon;
  let cardClass = "tl-card";
  let what: string;
  let badge: { className: string; text: string };
  let when: string;
  let body: string;

  switch (entry.type) {
    case "meeting_logged":
      iconClass = "meeting";
      Icon = CheckIcon;
      what = m.tlHeldWhat;
      badge = { className: "badge-success", text: m.statusHeld };
      when = formatMeetingAbsolute(meetingAt, { weekday: false });
      body = notes ?? labels.timelineMeetingLoggedDefault;
      break;
    case "meeting_rescheduled":
      cardClass = "tl-card moved";
      what = fillTemplate(m.tlScheduledWhat, { when: formatMeetingAbsolute(meetingAt) });
      badge = { className: "badge-neutral", text: m.statusRescheduled };
      when = formatMeetingAbsolute(at, { weekday: false });
      body = fillTemplate(m.tlRescheduledBody, { when: formatMeetingAbsolute(instant(meta.toAt, at)) });
      break;
    case "meeting_no_show":
      what = m.tlNoShowWhat;
      badge = { className: "badge-warn", text: m.statusNoShow };
      when = formatMeetingAbsolute(at, { weekday: false });
      body = reason ? fillTemplate(m.tlReasonPrefix, { reason }) : fillTemplate(m.tlNoShowBody, { when: formatMeetingAbsolute(meetingAt) });
      break;
    default:
      what = m.tlCancelledWhat;
      badge = { className: "badge-danger", text: m.statusCancelled };
      when = formatMeetingAbsolute(at, { weekday: false });
      body = reason ? fillTemplate(m.tlReasonPrefix, { reason }) : fillTemplate(m.tlCancelledBody, { when: formatMeetingAbsolute(meetingAt) });
  }

  return (
    <div className="tl-item">
      <div className={`tl-icon ${iconClass}`}>
        <Icon className="icon" />
      </div>
      <div className={cardClass}>
        <div className="tl-head">
          <span className="what">{what}</span>
          <span className={`badge ${badge.className} no-dot`}>{badge.text}</span>
          <span className="when">
            {when}
            {actor}
          </span>
        </div>
        <div className="tl-body">{body}</div>
      </div>
    </div>
  );
}

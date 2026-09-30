/**
 * "Reuniones agendadas" KPI drilldown (reports-bd-filter-drilldown fix).
 * Pure row normalizer for buildMeetingsDrilldownQuery's raw result — same
 * "normalize raw-SQL results" rule every other reports pure module follows.
 *
 * The KPI itself (and this drilldown) is actor-scoped
 * (`activity.actor_bd_id`, the BD who logged the `meeting_logged` row),
 * consistent with "Actividad por BD"'s own "Reuniones" column — NOT
 * owner-scoped like `funnel.meeting` (the "Embudo de contactos" card's last
 * row, which counts persons whose CURRENT status progressed to "meeting",
 * scoped by `person.owner_bd_id`). Those are two different numbers on the
 * same page by design; only this KPI's own activity-actor definition feeds
 * this drilldown.
 */

export interface MeetingDrilldownRawRow {
  activityId: string;
  personId: string;
  personFirstName: string | null;
  personLastName: string | null;
  companyKey: string | null;
  companyName: string | null;
  bdId: string | null;
  bdName: string | null;
  meetingAt: Date | string;
}

export interface MeetingDrilldownRow {
  activityId: string;
  personId: string;
  personName: string;
  companyKey: string | null;
  companyName: string | null;
  bdId: string | null;
  bdName: string | null;
  meetingAt: Date;
}

export function buildMeetingDrilldownRows(rows: readonly MeetingDrilldownRawRow[]): MeetingDrilldownRow[] {
  return rows.map((r) => ({
    activityId: r.activityId,
    personId: r.personId,
    personName: [r.personFirstName, r.personLastName].filter(Boolean).join(" ") || "—",
    companyKey: r.companyKey,
    companyName: r.companyName,
    bdId: r.bdId,
    bdName: r.bdName,
    meetingAt: r.meetingAt instanceof Date ? r.meetingAt : new Date(r.meetingAt),
  }));
}

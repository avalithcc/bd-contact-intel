/**
 * What /reuniones shows to whom (meeting-outcomes): the scope a viewer is allowed (a BD: only their own; an admin: everyone,
 * optionally narrowed by BD and a date range, defaulting to the current Argentina month), the default tab and the tab links.
 * Pure: the SQL that applies the scope is in queries.ts.
 */
import { isUuid } from "@/lib/uuid";
import { addDaysToDateString, argentinaCalendarDate, argentinaInstantBoundary } from "@/lib/tasks/argentinaDate";
import { MEETING_VIEWS, type MeetingView } from "@/lib/meetings/status";

export type MeetingViewCounts = Record<MeetingView, number>;

export interface MeetingScope {
  isAdmin: boolean;
  /** Null: every BD (admin only). */
  bdId: string | null;
  /** Inclusive lower and exclusive upper bound on `scheduled_at`, as real instants; null for a BD (no date filter). */
  from: Date | null;
  toExclusive: Date | null;
  /** The same range as the `YYYY-MM-DD` values the filter inputs show. */
  fromDate: string | null;
  toDate: string | null;
}

export interface MeetingFilterParams {
  bd?: string;
  from?: string;
  to?: string;
}

function validDate(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value ? value : null;
}

/** Last day of the month of a `YYYY-MM-DD` date. */
function endOfMonth(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
}

export function resolveMeetingScope(viewer: { id: string; role: string }, params: MeetingFilterParams, now: Date): MeetingScope {
  if (viewer.role !== "admin") {
    return { isAdmin: false, bdId: viewer.id, from: null, toExclusive: null, fromDate: null, toDate: null };
  }
  const monthStart = `${argentinaCalendarDate(now).slice(0, 7)}-01`;
  let fromDate = validDate(params.from) ?? monthStart;
  let toDate = validDate(params.to) ?? endOfMonth(fromDate);
  if (fromDate > toDate) [fromDate, toDate] = [toDate, fromDate];
  return {
    isAdmin: true,
    bdId: params.bd && isUuid(params.bd) ? params.bd : null,
    from: argentinaInstantBoundary(fromDate),
    toExclusive: argentinaInstantBoundary(addDaysToDateString(toDate, 1)),
    fromDate,
    toDate,
  };
}

/** "Por confirmar" when there is any; otherwise "Agendadas". */
export function defaultMeetingView(counts: MeetingViewCounts): MeetingView {
  return counts.pending > 0 ? "pending" : "scheduled";
}

export interface MeetingViewTab {
  key: MeetingView;
  label: string;
  href: string;
  count: number;
  active: boolean;
}

export function meetingViewTabs(
  counts: MeetingViewCounts,
  active: MeetingView,
  labels: Record<MeetingView, string>,
  filters: MeetingFilterParams,
): MeetingViewTab[] {
  return MEETING_VIEWS.map((key) => {
    const query = new URLSearchParams({ view: key });
    if (filters.bd) query.set("bd", filters.bd);
    if (filters.from) query.set("from", filters.from);
    if (filters.to) query.set("to", filters.to);
    return { key, label: labels[key], href: `/reuniones?${query.toString()}`, count: counts[key], active: key === active };
  });
}

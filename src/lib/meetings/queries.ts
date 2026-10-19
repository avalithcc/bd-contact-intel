/**
 * Reads behind /reuniones and the contact record's "Reunión agendada" strip (meeting-outcomes).
 *
 * The page costs ONE round trip (PERFORMANCE.md): tab counts, the rows of the active tab and, for an admin, the BD filter's
 * options come back from a single statement made of scalar subqueries. Raw SQL returns json, so every timestamp arrives as an
 * ISO string and every count as a number; both are normalized here, and no JS `Date` is ever interpolated into the template.
 * Every read is bounded (LIMIT) and rides meeting_bd_status_at_idx / meeting_status_at_idx.
 */
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { bd, meeting } from "@/db/schema";
import { canMutateMeeting } from "@/lib/meetings/outcome";
import { MEETING_VIEWS, type MeetingStatus, type MeetingView } from "@/lib/meetings/status";
import type { MeetingScope, MeetingViewCounts } from "@/lib/meetings/view";

/** Rows shown per tab; an admin looking at a whole month is the largest realistic read. */
export const MEETING_LIST_LIMIT = 200;

export interface MeetingListRow {
  id: string;
  personId: string;
  bdId: string;
  bdName: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  scheduledAt: Date;
  status: MeetingStatus;
  notes: string | null;
  reason: string | null;
  /** True only for the BD who owns the meeting: an admin reads the others', never changes them. */
  canMutate: boolean;
}

export interface MeetingPage {
  counts: MeetingViewCounts;
  rows: MeetingListRow[];
  /** Admin only: the BD filter's options. */
  bds: { id: string; name: string }[];
}

interface RawMeetingRow {
  id: string;
  personId: string;
  bdId: string;
  bdName: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  scheduledAt: string;
  status: string;
  notes: string | null;
  reason: string | null;
}

function scopeWhere(scope: MeetingScope): SQL {
  const parts: SQL[] = [sql`true`];
  if (scope.bdId) parts.push(sql`m.bd_id = ${scope.bdId}::uuid`);
  if (scope.from) parts.push(sql`m.scheduled_at >= ${scope.from.toISOString()}::timestamptz`);
  if (scope.toExclusive) parts.push(sql`m.scheduled_at < ${scope.toExclusive.toISOString()}::timestamptz`);
  return sql.join(parts, sql` and `);
}

/** The rows of whichever tab `eff` names: "pending" and "scheduled" split the open meetings at `now`, the rest are one status. */
function inActiveTab(nowIso: string): SQL {
  return sql`case (select t from eff)
    when 'pending' then (m.status = 'scheduled' and m.scheduled_at <= ${nowIso}::timestamptz)
    when 'scheduled' then (m.status = 'scheduled' and m.scheduled_at > ${nowIso}::timestamptz)
    else m.status = (select t from eff)
  end`;
}

/**
 * `view` null means "no tab in the URL": the statement picks Por confirmar when the scope has any, else Agendadas, and returns
 * its choice as `view`, so the default tab never costs a second read.
 */
export function getMeetingPage(viewerId: string, scope: MeetingScope, view: MeetingView | null, now: Date) {
  return getMeetingPageOn(db, viewerId, scope, view, now);
}

/** `executor` exists for tests/db (a rolled-back transaction); the page passes `db`. */
export async function getMeetingPageOn(
  executor: Pick<typeof db, "execute">,
  viewerId: string,
  scope: MeetingScope,
  view: MeetingView | null,
  now: Date,
): Promise<MeetingPage & { view: MeetingView }> {
  const nowIso = now.toISOString();
  const where = scopeWhere(scope);
  const result = (await executor.execute(sql`
    with eff as (
      select coalesce(
        ${view}::text,
        case when exists (
          select 1 from meeting m where ${where} and m.status = 'scheduled' and m.scheduled_at <= ${nowIso}::timestamptz
        ) then 'pending' else 'scheduled' end
      ) as t
    )
    select
      (select t from eff) as tab,
      (
        select json_build_object(
          'pending', count(*) filter (where m.status = 'scheduled' and m.scheduled_at <= ${nowIso}::timestamptz),
          'scheduled', count(*) filter (where m.status = 'scheduled' and m.scheduled_at > ${nowIso}::timestamptz),
          'held', count(*) filter (where m.status = 'held'),
          'no_show', count(*) filter (where m.status = 'no_show'),
          'rescheduled', count(*) filter (where m.status = 'rescheduled'),
          'cancelled', count(*) filter (where m.status = 'cancelled')
        )
        from meeting m
        where ${where}
      ) as counts,
      (
        select coalesce(json_agg(r), '[]'::json)
        from (
          select m.id as "id", m.person_id as "personId", m.bd_id as "bdId", b.name as "bdName",
                 p.first_name as "firstName", p.last_name as "lastName", p.company as "company",
                 m.scheduled_at as "scheduledAt", m.status as "status", m.notes as "notes", m.reason as "reason"
          from meeting m
          join person p on p.id = m.person_id
          join bd b on b.id = m.bd_id
          where ${where} and ${inActiveTab(nowIso)}
          -- Open tabs read oldest first (the most overdue, or the next to come); history reads newest first.
          order by case when (select t from eff) in ('pending', 'scheduled') then m.scheduled_at end asc nulls last, m.scheduled_at desc
          limit ${MEETING_LIST_LIMIT}
        ) r
      ) as rows,
      ${
        scope.isAdmin
          ? sql`(select coalesce(json_agg(json_build_object('id', bd.id, 'name', bd.name) order by bd.name), '[]'::json) from bd)`
          : sql`'[]'::json`
      } as bds
  `)) as unknown as { tab: MeetingView; counts: Record<MeetingView, number | string>; rows: RawMeetingRow[]; bds: { id: string; name: string }[] }[];
  const raw = result[0]!;
  return {
    view: raw.tab,
    counts: Object.fromEntries(MEETING_VIEWS.map((v) => [v, Number(raw.counts[v] ?? 0)])) as MeetingViewCounts,
    bds: raw.bds,
    rows: raw.rows.map((r) => ({
      ...r,
      status: r.status as MeetingStatus,
      scheduledAt: new Date(r.scheduledAt),
      canMutate: canMutateMeeting(viewerId, r),
    })),
  };
}

export interface PersonMeeting {
  id: string;
  bdId: string;
  bdName: string;
  scheduledAt: Date;
  notes: string | null;
  canMutate: boolean;
}

/**
 * The scheduled meetings of one contact for the record's strip and its "Próximas" group. A BD sees their own; an admin sees
 * every BD's (read-only for the others'). Nearest first, bounded.
 */
export function getScheduledMeetingsForPerson(personId: string, viewer: { id: string; role: string }) {
  return getScheduledMeetingsForPersonOn(db, personId, viewer);
}

export async function getScheduledMeetingsForPersonOn(
  executor: Pick<typeof db, "select">,
  personId: string,
  viewer: { id: string; role: string },
): Promise<PersonMeeting[]> {
  const rows = await executor
    .select({ id: meeting.id, bdId: meeting.bdId, bdName: bd.name, scheduledAt: meeting.scheduledAt, notes: meeting.notes })
    .from(meeting)
    .innerJoin(bd, eq(bd.id, meeting.bdId))
    .where(
      and(
        eq(meeting.personId, personId),
        eq(meeting.status, "scheduled"),
        viewer.role === "admin" ? undefined : eq(meeting.bdId, viewer.id),
      ),
    )
    .orderBy(asc(meeting.scheduledAt))
    .limit(20);
  return rows.map((r) => ({ ...r, canMutate: canMutateMeeting(viewer.id, r) }));
}

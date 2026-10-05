import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { activity, bd, companyPropertyHistory, person, task } from "@/db/schema";
import { effectiveActivityAtSql } from "@/lib/contacts/effectiveActivityTime";
import { buildCompanyTimelineEntry, type CompanyTimelineEntry } from "@/lib/companies/companyTimelineEntry";
import { notFoldedAttemptSql } from "@/lib/activity/callAttemptFold";
import { timelineOrderBySql } from "@/lib/activity/timelineOrder";
import type {
  CompanyActivityFilter,
  CompanyPropertyHistoryRow,
  CompanyTimelineFilterCounts,
} from "@/lib/companies/recordMappers";

const PEOPLE_LIMIT = 200; // bounded crossover set for the timeline/tasks joins below
const TIMELINE_LIMIT = 50;
const OPEN_TASKS_LIMIT = 5;
const ASSOC_PEOPLE_PREVIEW = 5;

export interface CompanyPersonRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  status: string;
}

export interface CompanyPeoplePage {
  rows: CompanyPersonRow[];
  total: number;
}

/**
 * People at this company (companies-checklist.md's Contactos card /
 * company-record.html:90) — matches `person.company_key` directly, same
 * known limitation as the list's contacts count (not alias-resolved yet,
 * flagged as a todo, not a blocker).
 */
export async function getCompanyPeople(companyKey: string, limit: number = ASSOC_PEOPLE_PREVIEW): Promise<CompanyPeoplePage> {
  const where = and(eq(person.companyKey, companyKey), isNull(person.mergedIntoId));
  const [[totalRow], rows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(person).where(where),
    db
      .select({ id: person.id, firstName: person.firstName, lastName: person.lastName, jobTitle: person.jobTitle, status: person.status })
      .from(person)
      .where(where)
      .orderBy(desc(person.updatedAt))
      .limit(limit),
  ]);
  return { rows, total: totalRow?.count ?? 0 };
}

/** Every person id at this company, bounded — used to scope the "Actividad
 * de contactos" timeline filter and the "Tareas abiertas" card to people
 * who actually work here, never an unbounded join. */
async function getCompanyPersonIds(companyKey: string): Promise<string[]> {
  const rows = await db
    .select({ id: person.id })
    .from(person)
    .where(and(eq(person.companyKey, companyKey), isNull(person.mergedIntoId)))
    .limit(PEOPLE_LIMIT);
  return rows.map((r) => r.id);
}

// Re-exported (not redefined) so every existing importer of
// `CompanyTimelineRow` from this module keeps working — the canonical shape
// now lives in companyTimelineEntry.ts, next to the pure mapping function
// that builds it.
export type { CompanyTimelineEntry as CompanyTimelineRow } from "@/lib/companies/companyTimelineEntry";

/**
 * Narrows the Activity tab's base WHERE (company row OR a row from any
 * person at this company) down to one filter's own rows, entirely in SQL —
 * the scoped-fetch counterpart of `filterTimelineRows` (recordMappers.ts).
 * `undefined` ("all") adds no extra condition.
 */
function companyFilterCondition(filter: CompanyActivityFilter | undefined) {
  switch (filter) {
    case "note":
      return and(eq(activity.type, "note"), isNull(activity.personId));
    case "stage_change":
      return and(eq(activity.type, "status_change"), isNull(activity.personId));
    case "contact_activity":
      return sql`${activity.personId} is not null`;
    default:
      return undefined;
  }
}

/**
 * Activity tab (company-record.html:78-83): company-scoped `activity` rows
 * (logged directly against this company) UNIONed with activity rows logged
 * against any person at this company ("Actividad de contactos" filter),
 * ordered by effective time (effectiveActivityAtSql, same rule as the list's
 * Última actividad column), bounded to TIMELINE_LIMIT — never an unbounded
 * per-company history dump.
 *
 * `opts.filter` (fix/company-timeline-filter-no-reload) narrows the SQL
 * query itself to one filter's own rows — the scoped fetch a filter click
 * falls back to when the already-loaded "all" pool can't be trusted for it
 * (see CompanyTimeline.tsx's `selectFilter` / `resolveCompanyScopeRows`).
 * `undefined` (the default) is the unfiltered "Todas" page.
 */
export async function getCompanyTimeline(
  companyKey: string,
  opts: { filter?: CompanyActivityFilter } = {},
): Promise<CompanyTimelineEntry[]> {
  const personIds = await getCompanyPersonIds(companyKey);

  const baseWhere = personIds.length
    ? and(or(eq(activity.companyKey, companyKey), inArray(activity.personId, personIds)), notFoldedAttemptSql())
    : and(eq(activity.companyKey, companyKey), notFoldedAttemptSql());
  const filterCondition = companyFilterCondition(opts.filter);

  const rows = await db
    .select({
      id: activity.id,
      type: activity.type,
      // Raw computed timestamptz — postgres-js returns a possibly
      // offset-less string at runtime, pinned to UTC below via
      // parseDbTimestamp (same class of bug effectiveActivityTime.ts
      // documents). `null` for a NON_TOUCH_ACTIVITY_TYPES row
      // (the ALL_TASK_ACTIVITY_TYPES task types, effectiveActivityAtSql's
      // `NULL` branch) — `rawCreatedAt` below is the display fallback for
      // exactly that case.
      at: sql<Date | string | null>`${effectiveActivityAtSql()}`,
      // A non-touch row still needs SOME time to render in the company
      // timeline (this is the DISPLAY fallback the ORDER BY below also
      // uses — see that comment). Drizzle's typed column mapper parses
      // this as a real Date already (it's a plain column reference, not a
      // computed `sql` expression); still routed through `parseDbTimestamp`
      // below for symmetry/safety.
      rawCreatedAt: activity.createdAt,
      metadata: activity.metadata,
      actorBdId: activity.actorBdId,
      personId: activity.personId,
    })
    .from(activity)
    .where(filterCondition ? and(baseWhere, filterCondition) : baseWhere)
    // DISPLAY time, not "last touch" time — see timelineOrder.ts's doc
    // comment for why this timeline must NOT use `NULLS LAST` here.
    .orderBy(timelineOrderBySql())
    .limit(TIMELINE_LIMIT);

  // Batched name lookups for whichever person/actor ids actually showed up
  // among the (already bounded) rows above — never a per-row query.
  const rowPersonIds = [...new Set(rows.map((r) => r.personId).filter((id): id is string => !!id))];
  const rowActorIds = [...new Set(rows.map((r) => r.actorBdId).filter((id): id is string => !!id))];
  const [people, actors] = await Promise.all([
    rowPersonIds.length
      ? db.select({ id: person.id, firstName: person.firstName, lastName: person.lastName }).from(person).where(inArray(person.id, rowPersonIds))
      : Promise.resolve([]),
    rowActorIds.length ? db.select({ id: bd.id, name: bd.name }).from(bd).where(inArray(bd.id, rowActorIds)) : Promise.resolve([]),
  ]);
  const personNameById = new Map(people.map((p) => [p.id, [p.firstName, p.lastName].filter(Boolean).join(" ") || null]));
  const actorNameById = new Map(actors.map((a) => [a.id, a.name]));

  return rows.map((r) => buildCompanyTimelineEntry(r, personNameById, actorNameById));
}

/**
 * True per-filter row counts for the Activity tab (fix/company-timeline-
 * filter-no-reload) — computed over EVERY matching row, never capped by
 * `getCompanyTimeline`'s `TIMELINE_LIMIT`. Mirrors `getPersonTimeline`'s
 * `countsByType` second query: the ground truth `isCompanyFilterSelectionComplete`
 * (recordMappers.ts) compares the client's already-loaded pool against
 * before trusting a purely local filter over a pill click.
 *
 * One query, four `count(*) filter (where ...)` aggregates over the same
 * base WHERE `getCompanyTimeline` uses — cheaper than four separate COUNT
 * queries, and guarantees all four numbers are consistent with each other
 * (no risk of a row landing in two counts, or none, from a race between
 * separate queries).
 */
export async function getCompanyTimelineFilterCounts(companyKey: string): Promise<CompanyTimelineFilterCounts> {
  const personIds = await getCompanyPersonIds(companyKey);
  const baseWhere = personIds.length
    ? and(or(eq(activity.companyKey, companyKey), inArray(activity.personId, personIds)), notFoldedAttemptSql())
    : and(eq(activity.companyKey, companyKey), notFoldedAttemptSql());

  const [row] = await db
    .select({
      all: sql<number>`count(*)`,
      note: sql<number>`count(*) filter (where ${activity.type} = 'note' and ${activity.personId} is null)`,
      stageChange: sql<number>`count(*) filter (where ${activity.type} = 'status_change' and ${activity.personId} is null)`,
      contactActivity: sql<number>`count(*) filter (where ${activity.personId} is not null)`,
    })
    .from(activity)
    .where(baseWhere);

  return {
    all: Number(row?.all ?? 0),
    note: Number(row?.note ?? 0),
    stage_change: Number(row?.stageChange ?? 0),
    contact_activity: Number(row?.contactActivity ?? 0),
  };
}

export interface CompanyOpenTaskRow {
  id: string;
  title: string;
  description: string | null;
  dueAt: Date | null;
  personId: string | null;
  companyKey: string | null;
  assignedToBdId: string | null;
  assignedToName: string | null;
  /** Set only for a person-scoped row (one of this company's contacts) —
   * the EditTaskDialog's "Asociado con" field (task-edit change) needs the
   * PERSON's own name in that case, not the company's. */
  personName: string | null;
}

/**
 * "Tareas abiertas" card (company-record.html:92) — `task.companyKey`/
 * `task.personId` already exist (src/db/schema.ts task_company_idx/
 * task_person_idx), so this needed no schema change. Bounded to
 * OPEN_TASKS_LIMIT, soonest due date first (nulls last). `description`/
 * `assignedToBdId`/`assignedToName`/`personName` join in for the task-edit
 * change's "Editar tarea" dialog — same single query, no added round trip.
 */
export async function getCompanyOpenTasks(companyKey: string): Promise<CompanyOpenTaskRow[]> {
  const personIds = await getCompanyPersonIds(companyKey);

  const rows = await db
    .select({
      id: task.id,
      title: task.title,
      description: task.description,
      dueAt: task.dueAt,
      personId: task.personId,
      companyKey: task.companyKey,
      assignedToBdId: task.assignedToBdId,
      assignedToName: bd.name,
      personFirstName: person.firstName,
      personLastName: person.lastName,
    })
    .from(task)
    .leftJoin(bd, eq(bd.id, task.assignedToBdId))
    .leftJoin(person, eq(person.id, task.personId))
    .where(
      and(
        eq(task.status, "open"),
        personIds.length ? or(eq(task.companyKey, companyKey), inArray(task.personId, personIds)) : eq(task.companyKey, companyKey),
      ),
    )
    .orderBy(asc(sql`${task.dueAt} is null`), asc(task.dueAt))
    .limit(OPEN_TASKS_LIMIT);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    dueAt: r.dueAt,
    personId: r.personId,
    companyKey: r.companyKey,
    assignedToBdId: r.assignedToBdId,
    assignedToName: r.assignedToName,
    personName: [r.personFirstName, r.personLastName].filter(Boolean).join(" ") || null,
  }));
}

/**
 * Last-edit-per-property hint for the About pane's Industria/Responsable/
 * Ciudad/País rows (mockup-port c05, wiring D1) — mirrors
 * src/lib/contacts/queries.ts's `personPropertyHistory` read exactly:
 * bounded to this one company, joined to `bd` for the "changed by" name,
 * ordered newest-first so `latestEditByProperty` (recordMappers.ts) can
 * take the first row per property.
 */
export async function getCompanyPropertyHistory(companyKey: string): Promise<CompanyPropertyHistoryRow[]> {
  return db
    .select({ property: companyPropertyHistory.property, bdName: bd.name, at: companyPropertyHistory.at })
    .from(companyPropertyHistory)
    .leftJoin(bd, eq(bd.id, companyPropertyHistory.changedByBdId))
    .where(eq(companyPropertyHistory.companyKey, companyKey))
    .orderBy(desc(companyPropertyHistory.at));
}

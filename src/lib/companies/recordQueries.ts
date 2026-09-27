import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { activity, bd, companyPropertyHistory, person, task } from "@/db/schema";
import { effectiveActivityAtSql } from "@/lib/contacts/effectiveActivityTime";
import type { CompanyPropertyHistoryRow } from "@/lib/companies/recordMappers";

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

export interface CompanyTimelineRow {
  id: string;
  type: string;
  createdAt: Date;
  metadata: Record<string, unknown> | null;
  actorName: string | null;
  personId: string | null;
  personName: string | null;
  scope: "company" | "contact";
}

/**
 * Activity tab (company-record.html:78-83): company-scoped `activity` rows
 * (logged directly against this company) UNIONed with activity rows logged
 * against any person at this company ("Actividad de contactos" filter),
 * ordered by effective time (effectiveActivityAtSql, same rule as the list's
 * Última actividad column), bounded to TIMELINE_LIMIT — never an unbounded
 * per-company history dump.
 */
export async function getCompanyTimeline(companyKey: string): Promise<CompanyTimelineRow[]> {
  const personIds = await getCompanyPersonIds(companyKey);

  const rows = await db
    .select({
      id: activity.id,
      type: activity.type,
      // Raw computed timestamptz — postgres-js returns a string at runtime,
      // normalized to Date below (same class of bug effectiveActivityTime.ts
      // documents).
      at: sql<Date | string>`${effectiveActivityAtSql()}`,
      metadata: activity.metadata,
      actorBdId: activity.actorBdId,
      personId: activity.personId,
    })
    .from(activity)
    .where(
      personIds.length
        ? or(eq(activity.companyKey, companyKey), inArray(activity.personId, personIds))
        : eq(activity.companyKey, companyKey),
    )
    .orderBy(desc(sql`${effectiveActivityAtSql()}`))
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

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    createdAt: new Date(r.at),
    metadata: r.metadata as Record<string, unknown> | null,
    actorName: r.actorBdId ? (actorNameById.get(r.actorBdId) ?? null) : null,
    personId: r.personId,
    personName: r.personId ? (personNameById.get(r.personId) ?? null) : null,
    scope: r.personId ? "contact" : "company",
  }));
}

export interface CompanyOpenTaskRow {
  id: string;
  title: string;
  dueAt: Date | null;
  personId: string | null;
}

/**
 * "Tareas abiertas" card (company-record.html:92) — `task.companyKey`/
 * `task.personId` already exist (src/db/schema.ts task_company_idx/
 * task_person_idx), so this needed no schema change. Bounded to
 * OPEN_TASKS_LIMIT, soonest due date first (nulls last).
 */
export async function getCompanyOpenTasks(companyKey: string): Promise<CompanyOpenTaskRow[]> {
  const personIds = await getCompanyPersonIds(companyKey);

  const rows = await db
    .select({ id: task.id, title: task.title, dueAt: task.dueAt, personId: task.personId })
    .from(task)
    .where(
      and(
        eq(task.status, "open"),
        personIds.length ? or(eq(task.companyKey, companyKey), inArray(task.personId, personIds)) : eq(task.companyKey, companyKey),
      ),
    )
    .orderBy(asc(sql`${task.dueAt} is null`), asc(task.dueAt))
    .limit(OPEN_TASKS_LIMIT);

  return rows;
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

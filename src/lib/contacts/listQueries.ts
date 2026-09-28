/**
 * Read side of the `/contacts` list (task 12.2-12.4; contact-list spec
 * "Central list, no per-BD scoping"). Not `bdId`-scoped — filters (owner,
 * status, hiring, email verified) apply on top of the whole shared
 * `person` table, same convention as contacts/queries.ts#getContactRecord.
 *
 * Server-side pagination and filtering in SQL (proposal: ~20k persons,
 * never load all rows) using the existing `person` indexes (owner, status,
 * company_key). `count(*)::int` casts the aggregate — Postgres returns
 * bigint aggregates as strings over the wire otherwise.
 */
import { and, asc, desc, eq, exists, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { activity, bd, person, personBdConnection } from "@/db/schema";
import { getHiringCompanyKeys, getHiringMatchIndex } from "@/lib/hiring/queries";
import type { ContactFilters } from "@/lib/contacts/viewFilters";
import { BOARD_COLUMNS } from "@/lib/contacts/board";
import { SYSTEM_VIEWS, type SystemViewKey } from "@/lib/contacts/views";
import type { PersonStatus } from "@/lib/status/deriveStatus";
import {
  CONTACT_LIST_ROW_COLUMNS,
  projectContactListRowColumns,
} from "@/lib/contacts/contactListRowColumns";
import {
  buildBdConnectionSummaries,
  groupBdConnectionsByPerson,
  type BdConnectionSummary,
} from "@/lib/contacts/bdConnections";
import { buildLastActivityEntries, type LastActivityEntry } from "@/lib/contacts/lastActivity";
import type { ContactSortKey } from "@/lib/contacts/sort";
import { idsFromContactListPage, type ContactIdsForFiltersResult } from "@/lib/contacts/bulkTargetIds";
import { buildSinceIso, effectiveActivityAtSql } from "@/lib/contacts/effectiveActivityTime";
import type { getDictionary } from "@/lib/i18n/server";

type Dict = Awaited<ReturnType<typeof getDictionary>>;

// `effectiveActivityAtSql` (bug fix, owner report: the DISTINCT ON
// latest-activity pick below, `lastActivityAgg`'s MAX, and the
// `lastActivityDays` EXISTS filter all need a `status_backfill` row's real
// historical time — `metadata.originalAt` — not `created_at`, when the
// migration ran; and a `call` row's real time — `metadata.occurredAt` — not
// `created_at`, when the dialog was saved) now lives in
// @/lib/contacts/effectiveActivityTime, the ONE shared helper every raw-SQL
// site reuses (also used by the Contact record timeline,
// src/lib/activity/queries.ts#getPersonTimeline) — see that module's doc
// comment for the rule and its guard.

const LIKE_WILDCARD_RE = /[%_\\]/g;
function escapeLikeWildcards(value: string): string {
  return value.replace(LIKE_WILDCARD_RE, (ch) => `\\${ch}`);
}

const MAX_SEARCH_TOKENS = 5;

/** Same `"me"` | `"unassigned"` | specific-BD-uuid shape as
 * src/lib/leads/queries.ts#ownerFilterCondition (task 13.3 parity gap:
 * "owner = a specific BD, or unassigned"). */
function ownerFilterCondition(owner: NonNullable<ContactFilters["owner"]>, meBdId: string) {
  if (owner === "me") return eq(person.ownerBdId, meBdId);
  if (owner === "unassigned") return isNull(person.ownerBdId);
  return eq(person.ownerBdId, owner);
}

/** Shared filter builder for the table/board/count reads below — keeps the
 * three call sites from drifting on which filters apply. `filters.status`
 * is deliberately NOT applied here (the board replaces it with grouping;
 * table/count apply it themselves via the caller). */
async function baseContactFilterConditions(
  filters: ContactFilters,
  meBdId: string,
  hiringKeys?: Set<string>,
) {
  const where = [sql`${person.mergedIntoId} is null`];
  if (filters.owner) where.push(ownerFilterCondition(filters.owner, meBdId));
  if (filters.emailStatus) where.push(eq(person.emailStatus, filters.emailStatus));
  else if (filters.emailVerified) where.push(eq(person.emailStatus, "verified"));
  if (filters.industryGroup) where.push(eq(person.industry, filters.industryGroup));
  if (filters.seniority) where.push(eq(person.seniority, filters.seniority));
  if (filters.hiring) {
    const keys = hiringKeys ?? (await getHiringCompanyKeys());
    where.push(keys.size ? inArray(person.companyKey, [...keys]) : sql`false`);
  }
  // "Mercado de contratación" / "Startup" ad-hoc filters (contacts.html
  // "Agregar filtro") — reuse getHiringMatchIndex the SAME way the Outreach
  // view's listOutreachCandidates does (src/lib/outreach/queries.ts), one
  // extra crossover query only when either is actually set, never on every
  // system-view count (those never set market/startupsOnly).
  if (filters.market || filters.startupsOnly) {
    const hiringIndex = await getHiringMatchIndex(filters.market, undefined, undefined, filters.startupsOnly);
    const matchKeys = [...new Set([...hiringIndex.values()].map((m) => m.companyKey))];
    where.push(matchKeys.length ? inArray(person.companyKey, matchKeys) : sql`false`);
  }
  // "Empresa" ad-hoc filter — substring match on the raw company name (not
  // companyKey — a BD types a free-text company name, same convention as
  // the global search's company token).
  if (filters.company) where.push(ilike(person.company, `%${escapeLikeWildcards(filters.company)}%`));
  // "Grupo de rol" ad-hoc filter.
  if (filters.roleGroup) where.push(eq(person.roleGroup, filters.roleGroup));
  // "Tiene teléfono" ad-hoc filter (migration 0016) — either phone column set.
  if (filters.hasPhone) {
    where.push(sql`(${person.phone} is not null or ${person.mobilePhone} is not null)`);
  }
  // "BD conectado" ad-hoc filter — EXISTS on person_bd_connection, never a
  // join that could fan out the outer person row.
  if (filters.bdConnected) {
    where.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(personBdConnection)
          .where(
            and(eq(personBdConnection.personId, person.id), eq(personBdConnection.bdId, filters.bdConnected)),
          ),
      ),
    );
  }
  // "Última actividad" ad-hoc filter (recency bucket) — same EXISTS
  // convention, bounded by `activity_person_idx`/`activity_created_idx`.
  // Prod bug fix: `since` MUST be a plain string (`buildSinceIso`), never a
  // raw JS `Date` interpolated into a `sql` template — postgres-js's raw
  // template driver only accepts string/number/boolean/null/Buffer/
  // ArrayBuffer, so a bare `${since}` Date threw across every
  // `?lastActivityDays=` request. Explicitly cast on the SQL side too
  // (`::timestamptz`) rather than relying on implicit coercion.
  if (filters.lastActivityDays) {
    const sinceIso = buildSinceIso(filters.lastActivityDays);
    where.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(activity)
          .where(
            and(eq(activity.personId, person.id), sql`${effectiveActivityAtSql()} >= ${sinceIso}::timestamptz`),
          ),
      ),
    );
  }
  return where;
}

function searchCondition(q: string) {
  const tokens = q.trim().split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_TOKENS);
  if (!tokens.length) return undefined;
  const tokenConditions = tokens.map((token) => {
    const pattern = `%${escapeLikeWildcards(token)}%`;
    return or(
      ilike(person.firstName, pattern),
      ilike(person.lastName, pattern),
      ilike(person.company, pattern),
      ilike(person.email, pattern),
    );
  });
  return and(...tokenConditions);
}

export interface ContactListRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  company: string | null;
  // "Empresa" column's inline "Contratando" badge (mockup: badge shown when
  // the row's company is in the current hiring-match index) needs the key,
  // not just the display name.
  companyKey: string | null;
  ownerBdId: string | null;
  ownerName: string | null;
  status: string;
  email: string | null;
  emailStatus: string;
  // Column-picker (task 13.1) additions — projected always, rendered only
  // when the resolved column set includes them (src/lib/contacts/columns.ts).
  roleGroup: string | null;
  industry: string | null;
  country: string | null;
  sourceKey: string | null;
  createdAt: Date;
  // Column-picker addition closing the `/leads` parity gap (task 13.3
  // inventory: "seniority filter AND column" — `person.seniority` already
  // existed with zero UI surface).
  seniority: string | null;
  // "Teléfono" column (migration 0016) — display prefers `phone`, falls
  // back to `mobilePhone` (same "primary, then secondary" convention the
  // record page's props panel shows both of separately; the list only has
  // room for one phone value per row).
  phone: string | null;
  mobilePhone: string | null;
  // "BDs conectados" column (mockups/contacts.html avatar-stack cell) —
  // populated by attachDerivedColumns() below, one extra batched query
  // scoped to exactly this page's ids, never a per-row query.
  bdConnections: BdConnectionSummary;
  // "Última actividad" column — same batching convention, `null` when a
  // person has zero `activity` rows (mockup renders "—").
  lastActivity: LastActivityEntry | null;
}

type ContactListRowBase = Omit<ContactListRow, "bdConnections" | "lastActivity">;

const EMPTY_BD_CONNECTION_SUMMARY: BdConnectionSummary = { avatars: [], title: "" };

/**
 * Batches the "BDs conectados" + "Última actividad" reads: TWO extra
 * queries total (never per-row) for every already-paginated row's
 * `person_bd_connection` rows and single most-recent `activity` row. The
 * `inArray`/`DISTINCT ON` sets are exactly the page/board-column/export ids
 * the caller already fetched, so this stays index-friendly
 * (`person_bd_connection`'s PK, `activity_person_idx`/`activity_created_idx`)
 * no matter how large the full tables get.
 */
async function attachDerivedColumns(
  rows: ContactListRowBase[],
  dict: Dict,
): Promise<ContactListRow[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);

  const [connectionRows, activityRows] = await Promise.all([
    db
      .select({
        personId: personBdConnection.personId,
        bdId: personBdConnection.bdId,
        bdName: bd.name,
      })
      .from(personBdConnection)
      .innerJoin(bd, eq(bd.id, personBdConnection.bdId))
      .where(inArray(personBdConnection.personId, ids)),
    db
      .selectDistinctOn([activity.personId], {
        personId: activity.personId,
        type: activity.type,
        metadata: activity.metadata,
        // Effective time (bug fix), not raw created_at — see
        // effectiveActivityAtSql's doc comment. Aliased `createdAt` so
        // buildLastActivityEntries' output shape is unchanged. Typed
        // `Date | string` (not just `Date`): postgres-js returns this
        // COMPUTED expression's wire value as a string at runtime (same
        // class of bug src/lib/outreach/queries.ts already normalizes
        // `lastMessageAt` for) — buildLastActivityEntries is the single
        // place that gets coerced to a real Date.
        createdAt: sql<Date | string>`${effectiveActivityAtSql()}`,
      })
      .from(activity)
      .where(and(inArray(activity.personId, ids), sql`${activity.personId} is not null`))
      .orderBy(activity.personId, desc(effectiveActivityAtSql())),
  ]);

  const groupedConnections = groupBdConnectionsByPerson(connectionRows);
  const lastActivityMap = buildLastActivityEntries(
    activityRows.map((r) => ({ ...r, personId: r.personId as string })),
    dict,
  );

  return rows.map((row) => ({
    ...row,
    bdConnections: groupedConnections.has(row.id)
      ? buildBdConnectionSummaries(groupedConnections.get(row.id)!)
      : EMPTY_BD_CONNECTION_SUMMARY,
    lastActivity: lastActivityMap.get(row.id) ?? null,
  }));
}

export interface ContactListPage {
  rows: ContactListRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * `meBdId` resolves the `owner: "me"` filter (contact-list spec: "My new
 * contacts" reproduced as a saved view). Rows with `merged_into_id` set are
 * always excluded — those are hidden from every read (design D1/D6).
 */
/**
 * Aggregate MAX(activity.createdAt) per person — used ONLY to ORDER BY
 * "Última actividad" at the SQL level (so pagination/LIMIT-OFFSET happens
 * on the correctly-sorted set, not re-sorted client-side after a page is
 * already cut). Separate from `attachDerivedColumns`'s per-row DISTINCT ON
 * fetch, which needs the *type* for the label, not just the max timestamp.
 */
const lastActivityAgg = db
  .select({
    personId: activity.personId,
    // Effective time (bug fix), not raw created_at.
    lastActivityAt: sql<Date>`max(${effectiveActivityAtSql()})`.as("last_activity_at"),
  })
  .from(activity)
  .where(sql`${activity.personId} is not null`)
  .groupBy(activity.personId)
  .as("last_activity_agg");

export async function getContactListPage(
  filters: ContactFilters,
  meBdId: string,
  q: string | undefined,
  page: number,
  pageSize: number,
  dict: Dict,
  sort: ContactSortKey = "lastActivity",
  hiringKeys?: Set<string>,
): Promise<ContactListPage> {
  const where = await baseContactFilterConditions(filters, meBdId, hiringKeys);
  if (filters.status?.length) where.push(inArray(person.status, filters.status));
  if (q) {
    const condition = searchCondition(q);
    if (condition) where.push(condition);
  }

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(person)
    .where(and(...where));

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const orderBy =
    sort === "lastActivity"
      ? [sql`${lastActivityAgg.lastActivityAt} desc nulls last`]
      : [asc(person.lastName), asc(person.firstName)];

  const baseRows = await db
    .select(CONTACT_LIST_ROW_COLUMNS)
    .from(person)
    .leftJoin(bd, eq(bd.id, person.ownerBdId))
    .leftJoin(lastActivityAgg, eq(lastActivityAgg.personId, person.id))
    .where(and(...where))
    .orderBy(...orderBy)
    .limit(pageSize)
    .offset((safePage - 1) * pageSize);

  const rows = await attachDerivedColumns(baseRows, dict);

  return { rows, total, page: safePage, pageSize, totalPages };
}

/**
 * "Seleccionar los N" filter-wide bulk mode (contacts.html:104) — the
 * server re-derives the id set from `ContactFilters`/`q` instead of a
 * checked-boxes list. Deliberately just page 1 of `getContactListPage`
 * with `pageSize = cap`, NOT a re-implementation of the filter logic —
 * this is the strongest possible guarantee that "the filter-derived set
 * equals what the list shows": the ids returned are exactly the first
 * `cap` rows the table itself would render for the same filters/sort,
 * because it's the literal same function, not a parallel query that could
 * drift. `total` is the FULL matching count, so the caller can tell
 * whether the cap actually truncated anything.
 */
export async function getContactIdsForFilters(
  filters: ContactFilters,
  meBdId: string,
  q: string | undefined,
  sort: ContactSortKey,
  dict: Dict,
  cap: number,
  hiringKeys?: Set<string>,
): Promise<ContactIdsForFiltersResult> {
  const page = await getContactListPage(filters, meBdId, q, 1, cap, dict, sort, hiringKeys);
  return idsFromContactListPage(page);
}

export interface ContactBoardColumn {
  status: PersonStatus;
  rows: ContactListRow[];
  total: number;
}

const BOARD_COLUMN_LIMIT = 20;

/**
 * Board view (task 14.1; mockups/contacts-board.html): groups the SAME base
 * filter set as `getContactListPage` (owner/email-verified/hiring/search —
 * `filters.status` is intentionally ignored, since the board replaces
 * status filtering with grouping) into the five `BOARD_COLUMNS`.
 *
 * Perf fix (owner report: moving one card took 3-5.5s): the previous version
 * looped over the 5 statuses and ran a count + a capped rows query per
 * column — up to 10 round trips before `attachDerivedColumns` even ran, on
 * a pool with `max: 3`. This now runs exactly ONE grouped count (`GROUP BY
 * status`) and ONE capped-per-partition rows query (`row_number() OVER
 * (PARTITION BY status ...)` in a CTE, filtered to <= BOARD_COLUMN_LIMIT),
 * then a single batched `attachDerivedColumns` call across every column's
 * rows at once — 4 round trips total regardless of how many columns have
 * rows, not 4 * BOARD_COLUMNS.length.
 */
export async function getContactBoardColumns(
  filters: ContactFilters,
  meBdId: string,
  q: string | undefined,
  dict: Dict,
  hiringKeys?: Set<string>,
): Promise<ContactBoardColumn[]> {
  const base = await baseContactFilterConditions(filters, meBdId, hiringKeys);
  if (q) {
    const condition = searchCondition(q);
    if (condition) base.push(condition);
  }
  const where = and(...base, inArray(person.status, [...BOARD_COLUMNS]));

  // brc_ (board-ranked-columns) prefix on the window-function alias so it
  // never collides with a joined table's own column when this CTE's
  // projection is re-selected below. `id asc` is a deliberate secondary
  // tiebreaker (bug found while verifying this rewrite against prod: a bulk
  // import gives thousands of rows the exact same `created_at`, and
  // `ORDER BY created_at DESC` alone leaves Postgres free to pick ANY of
  // them for the top `BOARD_COLUMN_LIMIT` depending on the query plan — the
  // pre-existing per-column query had the same defect, just never surfaced
  // because nothing compared it against another query shape) — every
  // ORDER BY that feeds a LIMIT must be fully deterministic.
  const rankedBoardRows = db.$with("brc_ranked").as(
    db
      .select({
        ...CONTACT_LIST_ROW_COLUMNS,
        brcRowNum: sql<number>`row_number() over (partition by ${person.status} order by ${person.createdAt} desc, ${person.id} asc)`.as(
          "brc_row_num",
        ),
      })
      .from(person)
      .leftJoin(bd, eq(bd.id, person.ownerBdId))
      .where(where),
  );

  const [countRows, baseRows] = await Promise.all([
    db
      .select({ status: person.status, brcTotal: sql<number>`count(*)::int` })
      .from(person)
      .where(where)
      .groupBy(person.status),
    db
      .with(rankedBoardRows)
      .select(projectContactListRowColumns(rankedBoardRows))
      .from(rankedBoardRows)
      .where(sql`${rankedBoardRows.brcRowNum} <= ${BOARD_COLUMN_LIMIT}`)
      .orderBy(asc(rankedBoardRows.status), desc(rankedBoardRows.createdAt), asc(rankedBoardRows.id)),
  ]);

  const totalByStatus = new Map(countRows.map((r) => [r.status, Number(r.brcTotal)]));
  const rowsByStatus = new Map<string, ContactListRowBase[]>();
  for (const row of baseRows) {
    const list = rowsByStatus.get(row.status) ?? [];
    list.push(row);
    rowsByStatus.set(row.status, list);
  }

  // ONE batched call across every column's rows (never per-column) — see
  // attachDerivedColumns' own doc comment for why this stays index-friendly
  // no matter how large the full tables get.
  const derivedRows = await attachDerivedColumns(baseRows, dict);
  const derivedByPersonId = new Map(derivedRows.map((r) => [r.id, r]));

  return BOARD_COLUMNS.map((status): ContactBoardColumn => {
    const idsForStatus = rowsByStatus.get(status) ?? [];
    const rows = idsForStatus.map((r) => derivedByPersonId.get(r.id)!);
    return { status: status as PersonStatus, rows, total: totalByStatus.get(status) ?? 0 };
  });
}

/**
 * Fetches the same row shape as getContactListPage, but for an explicit set
 * of ids (bulk "Exportar", task 13.2) instead of a filtered/paginated view —
 * the export always reflects exactly the rows the BD checked, not the
 * active view's filters. Excludes merged-away rows (design D1/D6), same as
 * every other read. No `total`/pagination — ids.length IS the row count,
 * already capped by sanitizeBulkPersonIds (MAX_BULK_SELECTION) upstream.
 */
export async function getContactListRowsByIds(ids: string[], dict: Dict): Promise<ContactListRow[]> {
  if (!ids.length) return [];
  const baseRows = await db
    .select(CONTACT_LIST_ROW_COLUMNS)
    .from(person)
    .leftJoin(bd, eq(bd.id, person.ownerBdId))
    .where(and(sql`${person.mergedIntoId} is null`, inArray(person.id, ids)));
  return attachDerivedColumns(baseRows, dict);
}

/**
 * One arbitrary-filter count (e.g. a saved view's own count, or an ad-hoc
 * preview) — a single round trip for that one filter set. NOT used for the
 * `SYSTEM_VIEWS` tab badges anymore; see `getSystemViewCounts` below for why.
 */
export async function getContactCountForFilters(
  filters: ContactFilters,
  meBdId: string,
  hiringKeys?: Set<string>,
): Promise<number> {
  const where = await baseContactFilterConditions(filters, meBdId, hiringKeys);
  if (filters.status?.length) where.push(inArray(person.status, filters.status));
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(person)
    .where(and(...where));
  return total;
}

/**
 * Per-view result counts for the tab badges (mockup: "Todos los
 * contactos<span class='count'>16,642</span>"), positionally aligned with
 * `SYSTEM_VIEWS` (same convention page.tsx already relies on:
 * `count={systemViewCounts[i]}`).
 *
 * Perf fix (owner report: ~3.0s for this block alone): the previous version
 * ran `getContactCountForFilters` once per system view — SIX full-table
 * `count(*)` round trips on EVERY `/contacts` render, including a plain
 * pagination click or sort that changes none of these filters. This now
 * runs ONE query with a `count(*) filter (where ...)` per view, computed in
 * a single pass over `person` — one round trip regardless of how many
 * system views exist.
 *
 * Freshness tradeoff: none — this is not a cache, it recomputes from the
 * live table on every call, so a status/owner/hiring change is reflected
 * immediately (same freshness as the old per-view queries, just cheaper).
 * The lever here was round trips, not staleness.
 */
export async function getSystemViewCounts(
  meBdId: string,
  hiringKeys?: Set<string>,
): Promise<number[]> {
  const conditionsByView = await Promise.all(
    SYSTEM_VIEWS.map(async (view) => {
      const where = await baseContactFilterConditions(view.filters, meBdId, hiringKeys);
      if (view.filters.status?.length) where.push(inArray(person.status, view.filters.status));
      return where;
    }),
  );

  const selection: Record<string, SQL<number>> = {};
  SYSTEM_VIEWS.forEach((view, i) => {
    selection[view.key] = sql<number>`count(*) filter (where ${and(...conditionsByView[i])})::int`;
  });

  const [row] = (await db.select(selection).from(person)) as [Record<SystemViewKey, number>];
  return SYSTEM_VIEWS.map((view) => row[view.key]);
}

/**
 * Distinct values for the ad-hoc `industryGroup`/`seniority` filter selects
 * (task 13.3 parity gap) — same "small distinct-value dropdown" pattern as
 * src/lib/leads/queries.ts#getLeadFilterOptions, but reading `person`.
 */
export interface ContactFilterOptions {
  industryGroups: string[];
  seniorities: string[];
}

export async function getContactFilterOptions(): Promise<ContactFilterOptions> {
  const [industryRows, seniorityRows] = await Promise.all([
    db
      .selectDistinct({ v: person.industry })
      .from(person)
      .where(sql`${person.industry} is not null`)
      .orderBy(asc(person.industry)),
    db
      .selectDistinct({ v: person.seniority })
      .from(person)
      .where(sql`${person.seniority} is not null`)
      .orderBy(asc(person.seniority)),
  ]);
  return {
    industryGroups: industryRows.map((r) => r.v).filter((v): v is string => !!v),
    seniorities: seniorityRows.map((r) => r.v).filter((v): v is string => !!v),
  };
}

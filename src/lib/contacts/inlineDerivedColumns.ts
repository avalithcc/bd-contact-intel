/**
 * DB-free glue for `getContactListPage`'s (listQueries.ts) inline JSON
 * columns — `bdConnectionsRaw`/`lastActivityRaw`, each a correlated-subquery
 * `json_agg`/`json_build_object` result scoped to exactly one row's person
 * (PR #196's round-trip fix; see listQueries.ts's doc comment on
 * `getContactListPage` for the SQL that produces these). Split out of
 * listQueries.ts — which imports `@/db` and throws without a live
 * `DATABASE_URL` — so this mapping is unit-testable without a database.
 *
 * `attachDerivedColumns` (still in listQueries.ts, used by the board and
 * `getContactListRowsByIds`) builds the SAME `ContactListRow.bdConnections`/
 * `lastActivity` fields from a batched (not inline) query shape, reusing the
 * same pure helpers this module calls (`buildBdConnectionSummaries`,
 * `formatLastActivityLabel`). Keep both paths on those shared helpers — see
 * tests/unit/inlineDerivedColumns.test.ts's parity test — so they can never
 * disagree on what a row's connections/last-activity should render as.
 */
import {
  buildBdConnectionSummaries,
  type BdConnectionRow,
  type BdConnectionSummary,
} from "@/lib/contacts/bdConnections";
import { formatLastActivityLabel, type LastActivityEntry } from "@/lib/contacts/lastActivity";
import type { ContactListRow, ContactListRowBase } from "@/lib/contacts/listQueries";
import { parseDbTimestamp } from "@/lib/db/timestamp";
import type { getDictionary } from "@/lib/i18n/server";

type Dict = Awaited<ReturnType<typeof getDictionary>>;

const EMPTY_BD_CONNECTION_SUMMARY: BdConnectionSummary = { avatars: [], title: "" };

/** One `lastActivityRaw` correlated-subquery result: `createdAt` is the
 * `effectiveActivityAtSql()` timestamptz expression, rendered to JSON text
 * by Postgres's `json_build_object` (`to_json`) — a wire STRING, never a JS
 * `Date`, at this layer. */
export interface InlineLastActivityRaw {
  type: string;
  metadata: unknown;
  createdAt: string;
}

export interface InlineDerivedRawRow extends ContactListRowBase {
  companyCanonicalName: string | null;
  bdConnectionsRaw: BdConnectionRow[] | null;
  lastActivityRaw: InlineLastActivityRaw | null;
}

/**
 * Bug found writing this module's tests: Postgres's `to_json` rendering of
 * a `timestamptz` value normally carries a UTC offset (e.g. `...+00`), but
 * `effectiveActivityAtSql()`'s `else` branch is a bare `timestamp without
 * time zone` column (`activity.created_at` — see db/schema.ts) before
 * Postgres's implicit cast unifies the `CASE` expression's type; relying on
 * that unification alone for every future caller/Postgres version is
 * fragile. If an offset-less string like `"2026-09-29T00:00:00"` ever
 * reaches here, the JS spec parses a date-time string with no trailing
 * `Z`/offset in the *process's local* timezone (`new Date(...)`), not UTC —
 * silently shifting the displayed last-activity time by the server's UTC
 * offset. `effectiveActivityAtSql()`'s own contract is "always UTC", so an
 * offset-less string is treated as UTC here explicitly rather than trusting
 * `new Date` to guess the same thing the DB meant. Delegates to the ONE
 * shared helper (src/lib/db/timestamp.ts#parseDbTimestamp) every other raw
 * DB timestamp call site now uses, so this rule can never drift from
 * theirs.
 */
function parseEffectiveActivityAt(value: string): Date {
  return parseDbTimestamp(value);
}

/**
 * Maps the inline JSON columns onto the render-ready shape
 * `attachDerivedColumns` used to produce. `bdConnectionsRaw` is already
 * scoped to exactly this row's person (the SQL `json_agg` correlated on
 * `pcl_page.id`), so no grouping step is needed here — unlike
 * `attachDerivedColumns`, which groups one shared batched result set by id.
 */
export function mapInlineDerivedColumns<
  T extends ContactListRowBase & {
    bdConnectionsRaw: BdConnectionRow[] | null;
    lastActivityRaw: InlineLastActivityRaw | null;
  },
>(rows: T[], dict: Dict): ContactListRow[] {
  return rows.map((row) => {
    const { bdConnectionsRaw, lastActivityRaw, ...base } = row;
    return {
      ...base,
      bdConnections: bdConnectionsRaw?.length
        ? buildBdConnectionSummaries(bdConnectionsRaw)
        : EMPTY_BD_CONNECTION_SUMMARY,
      lastActivity: lastActivityRaw
        ? {
            type: lastActivityRaw.type,
            label: formatLastActivityLabel(lastActivityRaw, dict),
            createdAt: parseEffectiveActivityAt(lastActivityRaw.createdAt),
          }
        : null,
    } satisfies ContactListRow;
  });
}

// Re-exported so `LastActivityEntry`'s shape can be referenced alongside
// this module's own types without a second import from lastActivity.ts.
export type { LastActivityEntry };

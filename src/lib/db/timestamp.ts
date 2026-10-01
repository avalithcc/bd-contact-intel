/**
 * Every timestamp column in this schema holds UTC (CLAUDE.md query rule 2 /
 * PERFORMANCE.md). The column TYPE is mid-migration: slices 1-5 of
 * openspec/decisions/2026-09-30-timestamptz-migration-plan.md converted 58
 * columns to `timestamptz`, while the tables still queued in slice 6
 * (email_account, email_message, follow_up_queue_item,
 * person_bd_connection) remain `timestamp without time zone`. Drizzle's
 * typed column mapper parses both kinds correctly, because its
 * `withTimezone` flag tracks the column — but any raw
 * `db.execute(sql...)` row, and any computed `sql` expression (an aggregate
 * like `max(...)`, or a `CASE` expression like
 * `effectiveActivityAtSql()`, src/lib/contacts/effectiveActivityTime.ts),
 * arrives from the postgres-js driver as a plain STRING at runtime — even
 * when typed `Date` at the call site. From a still-naive column that string
 * carries NO OFFSET, and `new Date(str)` on an offset-less string is parsed
 * in the *process's local* timezone, not UTC, silently shifting the value by
 * the server's UTC offset on any runtime that isn't UTC (Vercel prod happens
 * to run UTC; a contributor's laptop — or a future Vercel region/runtime
 * change — does not). Once slice 6 lands every raw string will carry an
 * offset and the `Z`-appending branch below becomes dead, but this helper
 * stays as the single place the rule is stated.
 *
 * `parseDbTimestamp` is the ONE shared place every such call site coerces
 * its raw value back into a real `Date`, so this rule is defined exactly
 * once. Two wire shapes are observed in this codebase and both must parse
 * to the same UTC instant regardless of the process's own timezone:
 *
 *   - postgres-js's own text format for a plain/aggregated column:
 *     space-separated, e.g. "2026-09-25 13:30:00.123456+00" (note: a
 *     zero-minute offset is rendered as a bare two-digit "+00", NOT
 *     "+00:00" — no colon, no minute digits).
 *   - Postgres's `to_json`/`json_build_object` rendering of a `timestamptz`
 *     (used by the contact list's inline JSON columns,
 *     src/lib/contacts/inlineDerivedColumns.ts): 'T'-separated ISO 8601,
 *     e.g. "2026-09-25T13:30:00+00:00".
 *
 * A string with EITHER shape's offset (or a bare `Z`) is trusted as-is —
 * neither appended to nor rewritten — and passed to `new Date(...)`
 * UNCHANGED,
 * including its original separator: V8's `Date` parser accepts a bare,
 * colon-less two-digit offset (`+00`) only through its lenient/legacy
 * (space-separated) path, and rejects it as Invalid Date on the strict ISO
 * ('T'-separated) path — so rewriting a space to `T` on an
 * already-offset string (postgres-js's own "+00" wire format) would
 * silently BREAK a value that already parsed correctly. An offset-less
 * string is pinned to UTC explicitly by appending `Z` (its original
 * separator, space or `T`, is left as-is — V8 accepts a trailing `Z` with
 * either), rather than trusting `new Date(...)` to guess the same thing the
 * DB meant. A `Date` instance (already correctly parsed — drizzle's own
 * typed columns, or an already-normalized value) passes through unchanged.
 */

// Matches a trailing zone designator: bare `Z`/`z`, or a `+`/`-` sign
// followed by a two-digit hour and an optional two-digit minute, with or
// without a colon separator (`+00`, `-03`, `+00:00`, `+0000`, `-03:00`, ...).
const HAS_ZONE_SUFFIX_RE = /(?:[zZ]|[+-]\d{2}(?::?\d{2})?)$/;

export function parseDbTimestamp(value: Date | string): Date {
  if (value instanceof Date) return value;
  return new Date(HAS_ZONE_SUFFIX_RE.test(value) ? value : `${value}Z`);
}

/**
 * Pure UUID shape check. Any route param that ends up in a `where(eq(col,
 * value))` against a `uuid` column MUST pass this first — Postgres rejects
 * a non-UUID string with "invalid input syntax for type uuid", which is an
 * uncaught driver error (no `error.tsx` catches it), not a handled 404.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

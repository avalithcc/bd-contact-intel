import { and, ilike, or, sql, type SQL } from "drizzle-orm";
import { company, companyAlias } from "@/db/schema";

/**
 * `/companies` text search ("q") — owner report: "no tengo buscador de
 * empresas, solo está el de contactos" (2026-09-30). Split out of
 * listQueries.ts, schema-only import (`@/db/schema`, no `@/db`), so it's
 * unit-testable without a live `DATABASE_URL` — same convention as
 * `accountTypeFilter.ts`/`roleVisibility.ts`.
 *
 * Mirrors contacts/listQueries.ts's own `searchCondition`: up to
 * `MAX_SEARCH_TOKENS` whitespace-split tokens, ANDed together, each token
 * matching if ANY of its fields match (OR).
 *
 * A company matches a token if its own `display_name`/`domain` matches, OR a
 * `company_alias` row points at it whose `alias_key` matches — via a
 * correlated `EXISTS`, never a `JOIN`. A `JOIN` against `company_alias`
 * would fan out one company row per matching alias; `EXISTS` can only ever
 * add `true`/`false` to the WHERE clause, so a company with several matching
 * aliases still appears exactly once (data-builder.md rule 5: pre-aggregate
 * / never let a fan-out join multiply rows).
 */

const LIKE_WILDCARD_RE = /[%_\\]/g;
function escapeLikeWildcards(value: string): string {
  return value.replace(LIKE_WILDCARD_RE, (ch) => `\\${ch}`);
}

const MAX_SEARCH_TOKENS = 5;

function aliasMatchCondition(pattern: string): SQL {
  return sql`exists (
    select 1 from ${companyAlias}
    where ${companyAlias.companyKey} = ${company.companyKey}
      and ${companyAlias.aliasKey} ilike ${pattern}
  )`;
}

function tokenCondition(token: string): SQL {
  const pattern = `%${escapeLikeWildcards(token)}%`;
  return or(ilike(company.displayName, pattern), ilike(company.domain, pattern), aliasMatchCondition(pattern))!;
}

/** `undefined` in (nothing to filter on), `undefined` out (no condition to
 * add) — same contract as `accountTypeCondition`. */
export function companySearchCondition(q: string | undefined): SQL | undefined {
  if (!q) return undefined;
  const tokens = q.trim().split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_TOKENS);
  if (!tokens.length) return undefined;
  return and(...tokens.map(tokenCondition));
}

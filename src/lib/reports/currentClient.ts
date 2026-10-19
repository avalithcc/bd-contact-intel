/**
 * SQL twin of clientStatus.ts#isCurrentClient for the reports: "this person's company is NOT a current client"
 * (owner definition 2026-10-19: relationship_stage = 'won' AND client_status = 'active').
 *
 * The person's `company_key` is canonicalized through `company_alias` first (a person filed under a merged-away
 * key belongs to the surviving company), with the same "only real aliases" rule as aliasRule.ts: an alias key that
 * is itself a live company key is not an alias. Both lookups are primary-key probes (`company_alias.alias_key`,
 * `company.company_key`), one per person row; a null company_key canonicalizes to null and matches no company, so
 * people without a company always count.
 *
 * Literal SQL text, no `${column}` interpolation: this is nested inside a statement that FROMs `person` and, in
 * places, `activity`, and PERFORMANCE.md documents Drizzle 0.36.4 re-emitting a reused column unqualified. The
 * call site must FROM `person` un-aliased.
 */
import { sql } from "drizzle-orm";

export function notCurrentClientPersonSql() {
  return sql`not exists (
    select 1 from company as cc_client
    where cc_client.relationship_stage = 'won'
      and cc_client.client_status = 'active'
      and cc_client.company_key = coalesce(
        (select cc_alias.company_key from company_alias as cc_alias
          where cc_alias.alias_key = person.company_key
            and not exists (select 1 from company as cc_live where cc_live.company_key = cc_alias.alias_key)),
        person.company_key
      )
  )`;
}

/**
 * Bugfix (PR #235 review, pre-existing gap also present on #232): a
 * person's LinkedIn conversation content was being resolved by joining
 * `conversation.peer_profile_key` directly to `person.profile_key`
 * (getOwnConversationMessages.ts, getConversationForAdmin.ts). That column
 * is single-valued (`person_profile_key_unique`) and is deliberately NOT
 * migrated by a merge (`MergePersonFields` in src/lib/identity/merge.ts has
 * no `profileKey` field) — the merged-away person keeps its own
 * `profile_key` forever, hidden behind `merged_into_id`. Meanwhile
 * `person_bd_connection` rows (the summary/count source, see
 * src/lib/contacts/queries.ts) ARE folded onto the survivor at merge time
 * (mergeDb.ts's `connectionsToRepoint`/`connectionConflicts`), so after a
 * merge the survivor's contact record showed a real message count and
 * last-message date, but expanding it to read the actual messages came back
 * empty — the count and the content disagreed.
 *
 * Fix (chosen over migrating `profile_key` on merge): resolve every LinkedIn
 * profile key that now belongs to a person by walking the `merged_into_id`
 * chain — the survivor's own `profile_key`, plus the `profile_key` of every
 * person that has been merged into it, directly or through a chain of
 * merges. This is preferred over copying the loser's key onto the survivor
 * because a person can legitimately have had TWO real LinkedIn profiles
 * merged (two separate connections, two conversations) — collapsing that
 * onto one `profile_key` column would either violate
 * `person_profile_key_unique` or silently drop one of the two. It also
 * requires no backfill: every row merged before this fix is fixed for free,
 * since `merged_into_id` and the merged-away row's own `profile_key` were
 * never touched or deleted by the merge.
 *
 * `mergedProfileKeysAnyCondition` is the ONE production entry point — both
 * read paths (getOwnConversationMessages.ts's own-history query,
 * getConversationForAdmin.ts's admin-bypass query) and this module's own pure
 * twin (`resolveMergedProfileKeys`, used only by this file's unit tests to
 * pin the exact closure semantics before the SQL was written) must stay in
 * sync; change one, change the other's test fixture.
 *
 * Coordinator-measured fix (read-only EXPLAIN ANALYZE against prod,
 * 6,081-row `conversation` table): the first version of this predicate used
 * `inArray(conversation.peerProfileKey, mergedProfileKeysSql(personId))`,
 * i.e. `peer_profile_key IN (<recursive CTE>)`. The planner could not turn
 * that into an index lookup on `conversation_bd_peer_idx` — 124ms cold /
 * 1.86ms warm, 239 buffers, `Seq Scan on conversation` over all 6,081 rows —
 * versus 0.43ms/95 buffers/index scan for the old direct
 * `person.profile_key` join it replaced. Rewriting the SAME subquery as
 * `peer_profile_key = ANY (ARRAY(<recursive CTE>))` measured 1.28–1.33ms, no
 * seq scan: `ARRAY(...)` forces Postgres to materialize the (tiny) key set
 * first, then the outer query can still use the index for `= ANY`. Keep this
 * shape; do not go back to `inArray`/`IN (...)` for this predicate.
 */
import { sql, type SQL } from "drizzle-orm";
import { conversation, person } from "@/db/schema";

export interface MergeChainPersonRow {
  id: string;
  mergedIntoId: string | null;
  profileKey: string | null;
}

/**
 * Pure reference implementation of the merge-chain walk `mergedProfileKeysSql`
 * performs in Postgres: every non-null `profileKey` belonging to `personId`
 * plus every person whose `mergedIntoId` chain (any depth) terminates at
 * `personId`. Never mutates `persons` — builds lookup maps and reads them.
 */
export function resolveMergedProfileKeys(personId: string, persons: readonly MergeChainPersonRow[]): string[] {
  const childrenByParent = new Map<string, MergeChainPersonRow[]>();
  for (const row of persons) {
    if (row.mergedIntoId == null) continue;
    const siblings = childrenByParent.get(row.mergedIntoId) ?? [];
    siblings.push(row);
    childrenByParent.set(row.mergedIntoId, siblings);
  }
  const byId = new Map(persons.map((row) => [row.id, row]));

  const keys = new Set<string>();
  const visited = new Set<string>();
  const stack = [personId];
  while (stack.length) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const row = byId.get(id);
    if (row?.profileKey) keys.add(row.profileKey);
    for (const child of childrenByParent.get(id) ?? []) stack.push(child.id);
  }
  return [...keys];
}

/**
 * Bare (unparenthesized) `SELECT` yielding every `profile_key` that
 * currently belongs to `personId` once merges are taken into account — NOT
 * meant to be embedded directly in a `WHERE ... IN (...)` clause (see
 * `mergedProfileKeysAnyCondition` below for the production entry point).
 * Exported only so this file's own PgDialect render test can pin the
 * recursive CTE's shape independent of the `ANY (ARRAY(...))` wrapper.
 *
 * Bounded and index-friendly: each recursive step is a lookup on
 * `person_merged_into_idx` (`merged_into_id`), and in production this chain
 * is at most a handful of hops (~26,600 persons, single-digit merge depth).
 * `person` is interpolated once (the anchor member); the recursive member
 * and final select reuse the literal `person` identifier instead of
 * re-interpolating `${person}` a second time inside the nested `WITH
 * RECURSIVE` — the same "don't reuse an interpolated reference inside a
 * nested subquery" rule PERFORMANCE.md documents for column references,
 * applied here to the table reference out of caution.
 */
export function mergedProfileKeysSql(personId: string): SQL {
  return sql`with recursive mpk_chain(mpk_id) as (
      select id from ${person} where id = ${personId}::uuid
      union all
      select person.id from person join mpk_chain on person.merged_into_id = mpk_chain.mpk_id
    )
    select profile_key from person where id in (select mpk_id from mpk_chain) and profile_key is not null`;
}

/**
 * Production entry point: a ready-to-`and()` condition testing
 * `conversation.peer_profile_key = ANY (ARRAY(<mergedProfileKeysSql>))` —
 * embed this directly in a `WHERE` clause (see this file's doc comment for
 * why `ANY (ARRAY(...))` and not `IN (...)`) so merge resolution costs zero
 * extra round trips. `personId` is a fixed value, not correlated to an
 * outer row, so Postgres evaluates the inner subquery once per statement,
 * not per row — never call this in a loop.
 */
export function mergedProfileKeysAnyCondition(personId: string): SQL {
  return sql`${conversation.peerProfileKey} = any(array(${mergedProfileKeysSql(personId)}))`;
}

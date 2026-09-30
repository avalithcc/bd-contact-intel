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
 * `mergedProfileKeysSql` is the ONE production entry point — both read paths
 * (getOwnConversationMessages.ts's own-history query, getConversationForAdmin.ts's
 * admin-bypass query) and this module's own pure twin
 * (`resolveMergedProfileKeys`, used only by this file's unit tests to pin the
 * exact closure semantics before the SQL was written) must stay in sync;
 * change one, change the other's test fixture.
 */
import { sql, type SQL } from "drizzle-orm";
import { person } from "@/db/schema";

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
 * SQL subquery expression yielding every `profile_key` that currently
 * belongs to `personId` once merges are taken into account — embed this
 * directly into a `WHERE ... IN (...)` clause (e.g. via drizzle's
 * `inArray(conversation.peerProfileKey, mergedProfileKeysSql(personId))`) so
 * merge resolution costs zero extra round trips. `personId` is a fixed
 * value, not correlated to an outer row, so Postgres evaluates this once per
 * statement (an `InitPlan`/hashed subplan), not per row — never call this in
 * a loop.
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
  return sql`(
    with recursive mpk_chain(mpk_id) as (
      select id from ${person} where id = ${personId}::uuid
      union all
      select person.id from person join mpk_chain on person.merged_into_id = mpk_chain.mpk_id
    )
    select profile_key from person where id in (select mpk_id from mpk_chain) and profile_key is not null
  )`;
}

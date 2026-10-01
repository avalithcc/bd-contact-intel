/**
 * Rules for the `when` field of drizzle/meta/_journal.json.
 *
 * Both drizzle-orm's migrator and `drizzle-kit migrate` run an entry only if
 * `Number(latest created_at in drizzle.__drizzle_migrations) < entry.when`.
 * Production's latest created_at is the future-dated, hand-set chain (slices
 * 1-6 of the timestamptz migration), so the chain is load-bearing: a new
 * entry stamped with the real clock would be silently skipped. Rewriting the
 * past `when` values would not help, because the ledger rows keep the old
 * created_at values.
 */
export const DAY_MS = 86_400_000;

/** Typo guard: a newest `when` further ahead than this is a mistake. */
export const MAX_FUTURE_MS = 90 * DAY_MS;

export interface JournalWhenEntry {
  idx: number;
  tag: string;
  when: number;
}

/** The `when` a new entry must carry: above every existing one, never below now. */
export function nextJournalWhen(entries: readonly JournalWhenEntry[], nowMs: number): number {
  if (entries.length === 0) return nowMs;
  const max = Math.max(...entries.map((entry) => entry.when));
  return max >= nowMs ? max + DAY_MS : nowMs;
}

/** Returns human-readable problems; an empty array means the journal is fine. */
export function checkJournalWhen(entries: readonly JournalWhenEntry[], nowMs: number): string[] {
  const problems: string[] = [];
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const cur = entries[i];
    if (cur.when > prev.when) continue;
    problems.push(
      `${cur.tag} (when=${cur.when}) must be later than ${prev.tag} (when=${prev.when}), otherwise drizzle-kit migrate silently skips it in production. ` +
        `\`npm run db:generate\` stamps the real clock, which is below the future-dated chain: set this entry's "when" in drizzle/meta/_journal.json to ${prev.when + DAY_MS} (previous + 1 day) by hand. ` +
        `Do NOT rewrite older entries: production's ledger already holds their values.`,
    );
  }
  const newest = entries.at(-1);
  if (newest && newest.when > nowMs + MAX_FUTURE_MS) {
    problems.push(`${newest.tag} (when=${newest.when}) is more than 90 days in the future; this looks like a typo.`);
  }
  return problems;
}

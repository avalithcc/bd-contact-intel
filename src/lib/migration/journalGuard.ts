/**
 * Pure structural guard for drizzle/meta/_journal.json against the SQL files in drizzle/.
 * Run on the real files by tests/unit/migrationJournal.test.ts (local, pre-commit hook, CI).
 *
 * Why it exists: drizzle-orm's migrator runs an entry only if `entry.when` is greater than the
 * latest `created_at` in drizzle.__drizzle_migrations, and it compares nothing else. A migration
 * generated with the real clock lands below the future-dated chain and is skipped while
 * `drizzle-kit migrate` still prints "migrations applied successfully". See README "Migrations".
 */

/**
 * The last journal idx that production's ledger has already applied and recorded (reconciled
 * 2026-10-26: 62 ledger rows = 62 files, idx 0..61). Entries up to here are grandfathered.
 */
export const LAST_APPLIED_IDX = 61;

/**
 * The ledger's max `created_at`, which is the `when` of idx LAST_APPLIED_IDX (2026-11-15, future-dated
 * by the repo's hand-set cadence). Every newer entry must carry a `when` strictly above it, or the
 * migrator skips it silently. Bump LAST_APPLIED_IDX and this together only after a new migration has
 * been applied to production and recorded in the ledger. README "Migrations" explains the rule.
 */
export const LEDGER_MAX_WHEN = 1_794_774_000_000;

const DAY_MS = 86_400_000;

export interface GuardEntry {
  idx: number;
  tag: string;
  when: number;
}

const MIGRATION_SQL = /^(\d{4})_.+\.sql$/;
const ROLLBACK_SQL = /_rollback\.sql$/;

/**
 * @param entries journal entries in file order
 * @param sqlFiles file names (not paths) found directly in drizzle/
 * @returns human-readable problems; an empty array means the journal is consistent
 */
export function checkMigrationJournal(entries: readonly GuardEntry[], sqlFiles: readonly string[]): string[] {
  const problems: string[] = [];
  const fileSet = new Set(sqlFiles);

  entries.forEach((entry, i) => {
    if (entry.idx !== i) {
      problems.push(`${entry.tag} has idx ${entry.idx} but sits at position ${i}: idx values must run 0..N-1 with no gaps or duplicates. Fix "idx" in drizzle/meta/_journal.json.`);
    }
    const prefix = entry.tag.slice(0, 4);
    if (prefix !== String(entry.idx).padStart(4, "0")) {
      problems.push(`${entry.tag} does not start with its idx (${String(entry.idx).padStart(4, "0")}). Rename the tag and its .sql file together.`);
    }
    if (!fileSet.has(`${entry.tag}.sql`)) {
      problems.push(`Journal tag ${entry.tag} has no drizzle/${entry.tag}.sql (missing file). Restore the SQL file or remove the journal entry.`);
    }
  });

  const tags = new Set(entries.map((e) => e.tag));
  for (const file of sqlFiles) {
    if (ROLLBACK_SQL.test(file) || !MIGRATION_SQL.test(file)) continue;
    if (!tags.has(file.slice(0, -".sql".length))) {
      problems.push(`drizzle/${file} has no entry in drizzle/meta/_journal.json, so migrate would never run it. Run \`npm run db:generate\` instead of hand-writing the file, or add the entry (see README "Migrations").`);
    }
  }

  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const cur = entries[i];
    if (cur.when > prev.when) continue;
    if (cur.idx > LAST_APPLIED_IDX && cur.when <= LEDGER_MAX_WHEN) continue; // reported once, below, with the same fix
    problems.push(
      `${cur.tag} (when=${cur.when}) must be strictly later than ${prev.tag} (when=${prev.when}). ` +
        `In drizzle/meta/_journal.json set this entry's "when" to ${Math.max(prev.when, LEDGER_MAX_WHEN) + DAY_MS} (previous + 1 day). Do not rewrite older entries.`,
    );
  }

  const boundary = entries.find((e) => e.idx === LAST_APPLIED_IDX);
  if (boundary && boundary.when !== LEDGER_MAX_WHEN) {
    problems.push(
      `${boundary.tag} is the last migration recorded as applied in production's ledger, and its "when" must stay ${LEDGER_MAX_WHEN} (found ${boundary.when}). ` +
        `Restore it: the ledger rows keep their original created_at, so editing it changes nothing in production and breaks this guard.`,
    );
  }

  for (let i = 1; i < entries.length; i++) {
    const cur = entries[i];
    if (cur.idx <= LAST_APPLIED_IDX || cur.when > LEDGER_MAX_WHEN) continue;
    problems.push(
      `${cur.tag} (when=${cur.when}) is not above the ledger max ${LEDGER_MAX_WHEN}: \`drizzle-kit migrate\` would silently skip it in production and still print "migrations applied successfully". ` +
        `\`npm run db:generate\` stamps the real clock, which is below the future-dated chain. In drizzle/meta/_journal.json set this entry's "when" to ${Math.max(entries[i - 1].when, LEDGER_MAX_WHEN) + DAY_MS} ` +
        `(previous entry + 1 day, above the ledger max), then regenerate or fix drizzle/meta/${String(cur.idx).padStart(4, "0")}_snapshot.json only if it is out of sync. Never use \`drizzle-kit push\` to work around it.`,
    );
  }

  return problems;
}

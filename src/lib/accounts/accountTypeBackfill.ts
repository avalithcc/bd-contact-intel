/**
 * Pure parsing/merge/write planner behind
 * scripts/backfill-company-account-type.ts (company-account-type change).
 * No I/O — the script reads the two Airtable "SEGUIMIENTO de cuentas"
 * export CSVs (backups/, never committed) with
 * src/lib/hubspot/parse.ts#parseHubSpotCsv (generic enough for any BOM'd,
 * comma CSV — not HubSpot-specific despite the module name), maps each row
 * with `mapAccountCsvRow`, merges duplicate account names with
 * `mergeAccountRows`, then diffs against the current `company` table with
 * `planAccountTypeWrites` before writing anything.
 *
 * Source data shape (both CSVs share the same header row): `Cuenta`,
 * `Assignee`, `Status`, `Categoría`, `Notes`, `Created`, `Estado 2`,
 * `Contratos & Documentos`.
 *
 * Field decisions (see scripts/backfill-company-account-type.ts's header
 * for the full rationale) — only `Categoría` (-> `company.account_type`)
 * and `Notes` (-> `company.notes`, fill-empty only) are written. `Status`
 * (constant "In progress" on every row), `Created` (an Airtable
 * bookkeeping date with no honest home on `company`), `Estado 2` (reads
 * like a pipeline signal but mapping it to `relationshipStage` is
 * explicitly out of scope for this change), and `Contratos & Documentos`
 * (a handful of Airtable-hosted, likely-expiring attachment URLs with no
 * dedicated column) are intentionally dropped — never persisted anywhere.
 *
 * `Assignee` ("Matias Abaro" / "Pablo Garcia") is dropped too: both left
 * the company, are not `bd` rows in this system, and the owner said to
 * leave ownership unassigned — no `owner_bd_id` is ever set here.
 */
import { normalizeCompanyKey } from "@/lib/companyCategories";

export type AccountType = "partner" | "client" | "strategic_org";

/** Airtable `Categoría` -> `company.account_type`. Deliberately its own
 * column, not `relationshipStage` (the sales pipeline) — see the
 * company-account-type design decision in schema.ts. */
export const CATEGORY_TO_ACCOUNT_TYPE: Readonly<Record<string, AccountType>> = {
  Partner: "partner",
  Cliente: "client",
  "Org. estratégica": "strategic_org",
};

/**
 * Known raw-name typo folds, discovered by cross-referencing shared
 * contact emails across differently-spelled account names (see
 * `findCrossNameEmailDomainOverlaps`): "Winclamp" and "Winclap" both
 * reference `lorenzo.ussher@winclap.com` and both say "Heredado." — same
 * real account, one misspelled row. Keyed by the RAW `Cuenta` string as it
 * appears in the CSV; the value is the canonical display name every row
 * folds into.
 */
export const ACCOUNT_NAME_ALIASES: Readonly<Record<string, string>> = {
  Winclamp: "Winclap",
};

/**
 * An owner-adjudicated `account_type` override. This is NOT a tie-break
 * rule — it exists for the cases where a rule (like latest-Created-date
 * conflict resolution) produced the wrong answer because the SOURCE DATA
 * itself was wrong on both sides, and a human looked at the account and
 * decided. Keyed by the canonical (post-`ACCOUNT_NAME_ALIASES`) display
 * name. Applied AFTER normal `Categoría` resolution in `mergeAccountRows`
 * — see `applyAccountTypeOverrides`.
 */
export interface AccountTypeOverride {
  accountType: AccountType;
  /** Why this override exists — must explain that a HUMAN decided, not
   * that a rule fired, so someone reading this in six months can tell the
   * difference. */
  reason: string;
}

/**
 * Declared owner overrides. Every entry here MUST correspond to an account
 * that actually shows up in the CSV input — `applyAccountTypeOverrides`
 * throws if one doesn't, so a typo in this map surfaces immediately instead
 * of silently doing nothing.
 *
 * "Dynamic Tours": both source exports disagreed on `Categoría` (grid view:
 * "Org. estratégica"; Pablo's view: "Cliente") — see the conflict this
 * module's `mergeAccountRows` still reports for it. The normal
 * latest-Created-date tie-break picked "Org. estratégica" (grid view is
 * dated 23/5/2024, later than Pablo's 16/11/2023), but the owner reviewed
 * the account directly and adjudicated on 2026-09-28 that BOTH source
 * values were wrong: Dynamic Tours is a `partner`. This override reflects
 * that human decision, not the disagreeing source rows.
 */
export const ACCOUNT_TYPE_OVERRIDES: Readonly<Record<string, AccountTypeOverride>> = {
  "Dynamic Tours": {
    accountType: "partner",
    reason:
      "Owner adjudicated on 2026-09-28: both source exports disagreed on Categoría " +
      '(grid: "Org. estratégica", Pablo: "Cliente") and neither was correct — Dynamic ' +
      "Tours is a partner. This is a human correction of the source data, not a tie-break.",
  },
};

export interface RawAccountRow {
  /** Which CSV this row came from (a file name or short label) — used only
   * for conflict reporting, never written. */
  source: string;
  account: string;
  category: string;
  notes: string;
  created: string;
}

function trimmedOrEmpty(value: string | undefined): string {
  return value?.trim() ?? "";
}

/** Maps one parsed CSV row (csv-parse's `Record<string,string>` projection)
 * to the fields this backfill actually reads. `Status`, `Estado 2`, and
 * `Contratos & Documentos` are intentionally not mapped — see this
 * module's header. */
export function mapAccountCsvRow(row: Record<string, string>, source: string): RawAccountRow {
  return {
    source,
    account: trimmedOrEmpty(row["Cuenta"]),
    category: trimmedOrEmpty(row["Categoría"]),
    notes: trimmedOrEmpty(row["Notes"]),
    created: trimmedOrEmpty(row["Created"]),
  };
}

/** Parses Airtable's `d/m/yyyy` (no leading zeros) into a `Date` for
 * conflict tie-breaking only — never written anywhere. Returns `null` for
 * anything that doesn't parse, so a malformed date never throws. */
export function parseAirtableCreatedDate(value: string): Date | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [, d, m, y] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? null : date;
}

export interface AccountCategoryConflict {
  displayName: string;
  candidates: { source: string; category: string; created: string }[];
  resolvedCategory: string;
}

export interface MergedAccount {
  companyKey: string;
  displayName: string;
  accountType: AccountType;
  /** Deduped, concatenated `Notes` text from every merged row, or `null`
   * when every row's `Notes` was empty. */
  notes: string | null;
}

/** One owner override actually applied to a resolved account — what the
 * normal resolution had produced, what it was replaced with, and why. This
 * is what gets printed on every run (dry run and execute alike) and what
 * gets written into the `audit_log` row on execute — an override must
 * never pass silently. */
export interface AppliedAccountTypeOverride {
  displayName: string;
  companyKey: string;
  previousAccountType: AccountType;
  accountType: AccountType;
  reason: string;
}

export interface AccountMergeResult {
  /** One entry per real account, sorted by `companyKey` for determinism.
   * Reflects any `overrides` already applied. */
  accounts: MergedAccount[];
  /** Any account name whose rows disagreed on `Categoría` (resolved by
   * the row with the latest parseable `Created` date; first-seen wins on
   * a tie or when neither date parses). Reported even when an override
   * later replaces the resolved value — both facts matter. */
  conflicts: AccountCategoryConflict[];
  /** Every owner override from `overrides` that matched an account in this
   * run, in `overrides` iteration order. */
  appliedOverrides: AppliedAccountTypeOverride[];
}

/**
 * Applies `overrides` (default: `ACCOUNT_TYPE_OVERRIDES`) to already-merged
 * accounts. Runs AFTER normal `Categoría` resolution — an override always
 * wins over whatever the CSVs (or their conflict tie-break) produced.
 *
 * Throws if an override names a display name that doesn't match any
 * account in `accounts` — a typo in the override map (or an account that
 * was renamed/removed from the source CSVs) must surface loudly, never
 * silently do nothing. Pure — returns new objects, never mutates `accounts`.
 */
export function applyAccountTypeOverrides(
  accounts: readonly MergedAccount[],
  overrides: Readonly<Record<string, AccountTypeOverride>> = ACCOUNT_TYPE_OVERRIDES,
): { accounts: MergedAccount[]; appliedOverrides: AppliedAccountTypeOverride[] } {
  const byName = new Map(accounts.map((a) => [a.displayName, a] as const));
  const appliedOverrides: AppliedAccountTypeOverride[] = [];

  for (const [displayName, override] of Object.entries(overrides)) {
    const account = byName.get(displayName);
    if (!account) {
      throw new Error(
        `Account type override names "${displayName}", which does not match any account in this run's ` +
          "input — check ACCOUNT_TYPE_OVERRIDES for a typo or a renamed/removed account before proceeding.",
      );
    }
    appliedOverrides.push({
      displayName,
      companyKey: account.companyKey,
      previousAccountType: account.accountType,
      accountType: override.accountType,
      reason: override.reason,
    });
    byName.set(displayName, { ...account, accountType: override.accountType });
  }

  return { accounts: accounts.map((a) => byName.get(a.displayName)!), appliedOverrides };
}

/**
 * Folds `ACCOUNT_NAME_ALIASES`, groups by the resulting display name,
 * resolves each group's `Categoría` (flagging disagreement), merges
 * `Notes` text, then applies `overrides` (default: `ACCOUNT_TYPE_OVERRIDES`)
 * on top. Pure — never mutates `rawRows`; safe to call twice with the same
 * input for the same result (write-rule R1).
 */
export function mergeAccountRows(
  rawRows: readonly RawAccountRow[],
  overrides: Readonly<Record<string, AccountTypeOverride>> = ACCOUNT_TYPE_OVERRIDES,
): AccountMergeResult {
  const groups = new Map<string, RawAccountRow[]>();
  for (const row of rawRows) {
    if (!row.account) continue;
    const canonical = ACCOUNT_NAME_ALIASES[row.account] ?? row.account;
    const group = groups.get(canonical);
    if (group) group.push(row);
    else groups.set(canonical, [row]);
  }

  const accounts: MergedAccount[] = [];
  const conflicts: AccountCategoryConflict[] = [];

  for (const [displayName, rows] of groups) {
    const categories = new Set(rows.map((r) => r.category).filter(Boolean));
    let resolvedCategory = rows[0]!.category;
    if (categories.size > 1) {
      const withDates = rows.map((r) => ({ row: r, date: parseAirtableCreatedDate(r.created) }));
      const latest = withDates.reduce((best, cur) => {
        if (!cur.date) return best;
        if (!best.date) return cur;
        return cur.date.getTime() > best.date.getTime() ? cur : best;
      }, withDates[0]!);
      resolvedCategory = latest.row.category;
      conflicts.push({
        displayName,
        candidates: rows.map((r) => ({ source: r.source, category: r.category, created: r.created })),
        resolvedCategory,
      });
    }

    const accountType = CATEGORY_TO_ACCOUNT_TYPE[resolvedCategory];
    if (!accountType) {
      throw new Error(`Unknown Categoría "${resolvedCategory}" for account "${displayName}"`);
    }

    const seenNotes = new Set<string>();
    const noteParts: string[] = [];
    for (const row of rows) {
      if (!row.notes || seenNotes.has(row.notes)) continue;
      seenNotes.add(row.notes);
      noteParts.push(row.notes);
    }

    accounts.push({
      companyKey: normalizeCompanyKey(displayName),
      displayName,
      accountType,
      notes: noteParts.length ? noteParts.join("\n\n") : null,
    });
  }

  accounts.sort((a, b) => a.companyKey.localeCompare(b.companyKey));
  const { accounts: overriddenAccounts, appliedOverrides } = applyAccountTypeOverrides(accounts, overrides);
  return { accounts: overriddenAccounts, conflicts, appliedOverrides };
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Extracts distinct, lowercased email addresses from free text — used both
 * for the "named people with emails" follow-up count and for
 * `findCrossNameEmailDomainOverlaps`. Pure, no I/O. */
export function extractEmails(text: string): string[] {
  const matches = text.match(EMAIL_RE) ?? [];
  return [...new Set(matches.map((m) => m.toLowerCase()))];
}

export interface EmailDomainOverlap {
  domain: string;
  displayNames: string[];
}

/**
 * Flags any email domain shared by two or more DIFFERENT merged account
 * names — a cheap heuristic for "these might be the same real company
 * under different names" (this is exactly how Winclamp/Winclap was
 * originally caught). Run this against `mergeAccountRows`'s output
 * BEFORE trusting the list is fully deduplicated.
 */
export function findCrossNameEmailDomainOverlaps(accounts: readonly MergedAccount[]): EmailDomainOverlap[] {
  const domainToNames = new Map<string, Set<string>>();
  for (const acc of accounts) {
    if (!acc.notes) continue;
    for (const email of extractEmails(acc.notes)) {
      const domain = email.split("@")[1];
      if (!domain) continue;
      const names = domainToNames.get(domain) ?? new Set<string>();
      names.add(acc.displayName);
      domainToNames.set(domain, names);
    }
  }
  const overlaps: EmailDomainOverlap[] = [];
  for (const [domain, names] of domainToNames) {
    if (names.size > 1) overlaps.push({ domain, displayNames: [...names].sort() });
  }
  return overlaps.sort((a, b) => a.domain.localeCompare(b.domain));
}

export interface ExistingAccountCompanyRef {
  companyKey: string;
  notes: string | null;
}

export interface CompanyToCreateForAccountType {
  companyKey: string;
  displayName: string;
  accountType: AccountType;
  notes: string | null;
}

export interface ExistingAccountTypeUpdate {
  companyKey: string;
  accountType: AccountType;
}

export interface ExistingNotesFill {
  companyKey: string;
  notes: string;
}

export interface AccountTypeWritePlan {
  companiesToCreate: CompanyToCreateForAccountType[];
  existingAccountTypeUpdates: ExistingAccountTypeUpdate[];
  existingNotesFills: ExistingNotesFill[];
  /** Existing companies whose `notes` was already non-empty — the
   * fill-empty rule skips overwriting them; their CSV `Notes` text (if
   * any) is dropped, never appended, never overwritten. */
  existingNotesSkipped: { companyKey: string }[];
}

/**
 * Diffs `mergeAccountRows`'s output against the current `company` table
 * state (`existingByKey`, one row per companyKey read once by the script —
 * never a per-row query). Pure — never mutates `accounts` or
 * `existingByKey`; safe to call twice with the same input for the same
 * result (write-rule R1).
 */
export function planAccountTypeWrites(
  accounts: readonly MergedAccount[],
  existingByKey: ReadonlyMap<string, ExistingAccountCompanyRef>,
): AccountTypeWritePlan {
  const companiesToCreate: CompanyToCreateForAccountType[] = [];
  const existingAccountTypeUpdates: ExistingAccountTypeUpdate[] = [];
  const existingNotesFills: ExistingNotesFill[] = [];
  const existingNotesSkipped: { companyKey: string }[] = [];

  for (const acc of accounts) {
    const existing = existingByKey.get(acc.companyKey);
    if (!existing) {
      companiesToCreate.push({
        companyKey: acc.companyKey,
        displayName: acc.displayName,
        accountType: acc.accountType,
        notes: acc.notes,
      });
      continue;
    }

    existingAccountTypeUpdates.push({ companyKey: acc.companyKey, accountType: acc.accountType });

    if (acc.notes) {
      const currentNotes = existing.notes?.trim();
      if (!currentNotes) {
        existingNotesFills.push({ companyKey: acc.companyKey, notes: acc.notes });
      } else {
        existingNotesSkipped.push({ companyKey: acc.companyKey });
      }
    }
  }

  return { companiesToCreate, existingAccountTypeUpdates, existingNotesFills, existingNotesSkipped };
}

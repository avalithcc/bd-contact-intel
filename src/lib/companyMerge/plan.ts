/**
 * Pure planner for scripts/merge-companies.ts: parses the explicit, human-confirmed groups, merges the company
 * fields and finds what must block an execute. No I/O, and it never mutates what it is given.
 */
import { COMPANY_KEY_TABLES, refCount } from "./keys";

/**
 * Strongest first. The owner: "Si en 1 dice WON, tomemos este como dato importante." A `won` is a historical fact
 * about the relationship, so it must survive a merge whichever record survives; `lost` is the weakest claim, so any
 * other stated stage beats it. A stage outside this list (or none) ranks below every listed one.
 */
export const STAGE_STRENGTH: readonly string[] = ["won", "proposal_sent", "qualified", "prospect", "lost"];

const stageRank = (s: string | null): number => (s !== null && STAGE_STRENGTH.includes(s) ? STAGE_STRENGTH.length - STAGE_STRENGTH.indexOf(s) : -1);

/** The stronger of two stages; a tie keeps `a`. */
export const strongestStage = (a: string | null, b: string | null): string | null => (stageRank(b) > stageRank(a) ? b : a);

export interface CompanyRow {
  companyKey: string;
  displayName: string;
  relationshipStage: string | null;
  revenuePotential: number | null;
  notes: string | null;
  domain: string | null;
  industry: string | null;
  ownerBdId: string | null;
  city: string | null;
  country: string | null;
  accountType: string | null;
  clientStatus: string | null;
  linkedinUrl: string | null;
}
type Field = Exclude<keyof CompanyRow, "companyKey" | "displayName">;

/** field -> [column, sql type]. Order is the order history rows are written. Stage is merged by rank, the rest fill-empty. */
export const MERGE_FIELDS: Record<Field, readonly [string, string]> = {
  relationshipStage: ["relationship_stage", "text"],
  revenuePotential: ["revenue_potential", "integer"],
  notes: ["notes", "text"],
  domain: ["domain", "text"],
  industry: ["industry", "text"],
  ownerBdId: ["owner_bd_id", "uuid"],
  city: ["city", "text"],
  country: ["country", "text"],
  accountType: ["account_type", "text"],
  clientStatus: ["client_status", "text"],
  linkedinUrl: ["linkedin_url", "text"],
};
const FILL_FIELDS = (Object.keys(MERGE_FIELDS) as Field[]).filter((f) => f !== "relationshipStage");

export interface FieldChange {
  field: Field;
  oldValue: string | null;
  newValue: string | null;
}
/** A value that did not survive. `value` is null for notes: free text may hold PII, so only the count is kept. */
export interface DiscardedValue {
  deadKey: string;
  field: Field;
  value: string | null;
}

const isBlank = (v: string | number | null): boolean => v === null || (typeof v === "string" && v.trim() === "");
const str = (v: string | number | null): string | null => (v === null ? null : String(v));

export function mergeCompanyFields(survivor: CompanyRow, deads: readonly CompanyRow[]) {
  const merged: CompanyRow = { ...survivor };
  const discarded: DiscardedValue[] = [];
  for (const dead of deads) {
    const stage = strongestStage(merged.relationshipStage, dead.relationshipStage);
    const loser = stage === merged.relationshipStage ? dead.relationshipStage : merged.relationshipStage;
    if (loser !== stage && !isBlank(loser)) discarded.push({ deadKey: dead.companyKey, field: "relationshipStage", value: loser });
    merged.relationshipStage = stage;
    for (const field of FILL_FIELDS) {
      const have = merged[field];
      const other = dead[field];
      if (isBlank(other)) continue;
      if (isBlank(have)) (merged as unknown as Record<string, unknown>)[field] = other;
      else if (have !== other) discarded.push({ deadKey: dead.companyKey, field, value: field === "notes" ? null : str(other) });
    }
  }
  const changes: FieldChange[] = (Object.keys(MERGE_FIELDS) as Field[])
    .filter((f) => merged[f] !== survivor[f])
    .map((f) => ({ field: f, oldValue: str(survivor[f]), newValue: str(merged[f]) }));
  return { merged, changes, discarded };
}

export interface MergeGroup {
  survivorKey: string;
  deadKeys: string[];
}
const MAX_GROUPS = 100;

export function parseGroupSpec(spec: string): MergeGroup {
  const parts = spec.split(":").map((s) => s.trim());
  const deadKeys = (parts[1] ?? "").split(",").map((s) => s.trim());
  if (parts.length !== 2 || !parts[0] || deadKeys.some((k) => !k)) {
    throw new Error(`Bad group "${spec}": expected survivor:dead[,dead...] (keys containing ':' or ',' are not supported).`);
  }
  if (deadKeys.includes(parts[0])) throw new Error(`Bad group "${spec}": a key cannot be merged into itself.`);
  return { survivorKey: parts[0], deadKeys };
}

/** One spec per line; blank lines and `#` comments are skipped. A key may appear once in the whole input. */
export function parseGroupLines(lines: readonly string[]): MergeGroup[] {
  const groups = lines.map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map(parseGroupSpec);
  if (!groups.length) throw new Error("Pass at least one --group=<survivor>:<dead>[,<dead>...] (or --file=).");
  if (groups.length > MAX_GROUPS) throw new Error(`At most ${MAX_GROUPS} groups per run.`);
  const keys = groups.flatMap((g) => [g.survivorKey, ...g.deadKeys]);
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dup !== undefined) throw new Error(`Key "${dup}" appears more than once across the groups.`);
  return groups;
}

export interface GroupPlan extends MergeGroup {
  displayNames: Record<string, string>;
  merged: CompanyRow;
  changes: FieldChange[];
  discarded: DiscardedValue[];
}

export function planMerge(groups: readonly MergeGroup[], companies: ReadonlyMap<string, CompanyRow>): GroupPlan[] {
  const get = (key: string): CompanyRow => {
    const found = companies.get(key);
    if (!found) throw new Error(`No company row with company_key "${key}".`);
    return found;
  };
  return groups.map((g) => {
    const survivor = get(g.survivorKey);
    const deads = g.deadKeys.map(get);
    return {
      survivorKey: g.survivorKey,
      deadKeys: [...g.deadKeys],
      displayNames: Object.fromEntries([survivor, ...deads].map((c) => [c.companyKey, c.displayName])),
      ...mergeCompanyFields(survivor, deads),
    };
  });
}

/** Rows that will leave a dead key, per table. */
export function movedRowCounts(plans: readonly GroupPlan[], counts: ReadonlyMap<string, number>): Record<string, number> {
  return Object.fromEntries(
    COMPANY_KEY_TABLES.map((t) => [t, plans.reduce((sum, p) => sum + p.deadKeys.reduce((s, k) => s + refCount(counts, t, k), 0), 0)]),
  );
}

export interface MergeContext {
  /** Keys (of the groups) that have a `target_company` row. */
  targetKeys: ReadonlySet<string>;
  /** `company_alias` rows whose alias_key is one of the groups' keys: alias_key -> company_key. */
  aliasTargets: ReadonlyMap<string, string>;
  /** Whether `company_alias.company_key` still has its FK to `target_company` (migration 0039 moves it to `company`). */
  aliasFkToTarget: boolean;
}

/** Reasons an execute must refuse. The dry run prints them; nothing is left to a constraint error. */
export function findBlockers(plans: readonly GroupPlan[], ctx: MergeContext): string[] {
  const blockers: string[] = [];
  for (const p of plans) {
    for (const dead of p.deadKeys) {
      const to = ctx.aliasTargets.get(dead);
      if (to !== undefined && to !== p.survivorKey && to !== dead) blockers.push(`"${dead}" is already an alias of "${to}", not of "${p.survivorKey}".`);
    }
    const hasTarget = [p.survivorKey, ...p.deadKeys].some((k) => ctx.targetKeys.has(k));
    if (ctx.aliasFkToTarget && !hasTarget) {
      blockers.push(`company_alias still has its FK to target_company and "${p.survivorKey}" is not a target company: apply migration 0039 first.`);
    }
  }
  return blockers;
}

export interface CandidateRecord {
  companyKey: string;
  displayName: string;
  stage: string | null;
  domain: string | null;
  contacts: number;
  squash: string;
}

/** Report mode: squash-equal records grouped, biggest group first; within a group the record with most contacts leads. */
export function groupCandidates(records: readonly CandidateRecord[]) {
  const bySquash = new Map<string, CandidateRecord[]>();
  for (const r of records) bySquash.set(r.squash, [...(bySquash.get(r.squash) ?? []), r]);
  return [...bySquash.values()]
    .filter((g) => g.length > 1)
    .map((g) => {
      const sorted = [...g].sort((a, b) => b.contacts - a.contacts || a.companyKey.localeCompare(b.companyKey));
      return { squash: sorted[0]!.squash, records: sorted, contacts: sorted.reduce((n, r) => n + r.contacts, 0) };
    })
    .sort((a, b) => b.contacts - a.contacts || a.squash.localeCompare(b.squash));
}

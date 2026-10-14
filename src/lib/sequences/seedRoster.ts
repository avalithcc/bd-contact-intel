/**
 * Pure admission for the owner-gated seed of the first real Sequence (scripts/seed-outreach-sequence.ts). No DB access.
 *
 * The roster below was hand-picked by the owner on 2026-10-14 and the script runs later, so every candidate is
 * RE-VALIDATED against live row state. Anyone who drops off comes back in `rejected` with a reason and is left out.
 * There is deliberately no replacement logic: a Contact the owner never chose, emailed under his name, is far worse
 * than a short list.
 */
import { COMPANY_MEMBER_LIMIT, staticRosterRejection, type RosterCandidate } from "./rosterGuards";
import type { SuppressionRule } from "./suppression";

export const SEED_SEQUENCE_NAME = "Florida + US · octubre";
export const SEED_DAILY_SEND_CAP = 5;

export interface SeedRosterEntry {
  /** First and last name as stored on the person. */
  readonly name: string;
  /** company.display_name. */
  readonly company: string;
}

/** The owner's ten, in tier order. */
export const SEED_ROSTER: readonly SeedRosterEntry[] = [
  { name: "Brian Casteel", company: "Upshop" },
  { name: "Saumya Jossy", company: "Upshop" },
  { name: "Adrian Pulido", company: "Nubank" },
  { name: "Joe Dilaura", company: "Snowflake" },
  { name: "Melissa Dominguez", company: "Snowflake" },
  { name: "Kevin Harris", company: "Twilio" },
  { name: "Stefano Fontanelli", company: "Twilio" },
  { name: "Jose Velez", company: "Bold" },
  { name: "Anderson Romero", company: "Bold" },
  { name: "Andy Ellis", company: "Cint" },
];

export interface SeedCandidate extends RosterCandidate {
  /** Human label for reports ("Name @ Company"). */
  label: string;
  /** The company has an open IT posting right now. */
  hasOpenItPosting: boolean;
}

export interface SeedGuards {
  suppressionRules: readonly SuppressionRule[];
  /** Persons already on the Sequence in ANY state, discarded included: a hand removal is never undone by a re-run. */
  alreadyMemberPersonIds: ReadonlySet<string>;
  /** Non-discarded members already on the Sequence per person.company_key. */
  activeCountByCompany: ReadonlyMap<string, number>;
}

export type SeedRejection = "already_member" | "merged" | "no_email" | "unreachable" | "no_open_posting" | "client" | "suppressed" | "company_limit";

export interface SeedResolution {
  admitted: SeedCandidate[];
  rejected: { candidate: SeedCandidate; reason: SeedRejection }[];
}

export interface SeedArgs {
  apply: boolean;
  actor: string | null;
}

/** `--dry-run` is the default. Writing needs BOTH `--apply` and `--actor=<bd id>`; anything unknown is refused. */
export function parseSeedArgs(argv: readonly string[]): SeedArgs {
  let apply = false;
  let dryRun = false;
  let actor: string | null = null;
  for (const a of argv) {
    if (a === "--apply") apply = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a.startsWith("--actor=")) actor = a.slice(8).trim() || null;
    else throw new Error(`Unknown argument: ${a}. Valid: --dry-run (default), --apply, --actor=<bd id>`);
  }
  if (apply && dryRun) throw new Error("--apply and --dry-run contradict each other.");
  if (apply && !actor) throw new Error("--apply requires --actor=<bd id> for the audit log.");
  return { apply, actor };
}

export function resolveSeedRoster(candidates: readonly SeedCandidate[], guards: SeedGuards): SeedResolution {
  const out: SeedResolution = { admitted: [], rejected: [] };
  const counts = new Map(guards.activeCountByCompany);
  for (const c of candidates) {
    const reason = rejection(c, guards, counts);
    if (reason) {
      out.rejected.push({ candidate: c, reason });
      continue;
    }
    if (c.companyKey) counts.set(c.companyKey, (counts.get(c.companyKey) ?? 0) + 1);
    out.admitted.push(c);
  }
  return out;
}

function rejection(c: SeedCandidate, g: SeedGuards, counts: ReadonlyMap<string, number>): SeedRejection | null {
  if (g.alreadyMemberPersonIds.has(c.personId)) return "already_member";
  if (c.mergedIntoId) return "merged";
  if (!c.email?.trim()) return "no_email";
  if (!c.hasOpenItPosting) return "no_open_posting";
  const shared = staticRosterRejection(c, g.suppressionRules);
  if (shared === "unreachable" || shared === "client" || shared === "suppressed") return shared;
  if (c.companyKey && (counts.get(c.companyKey) ?? 0) >= COMPANY_MEMBER_LIMIT) return "company_limit";
  return null;
}

/**
 * Pure decisions for "this company was absorbed by that one" proposals (table `company_absorption_proposal`).
 * A proposal is a SUGGESTION: the merge itself stays owner-only (scripts/merge-companies.ts) and never reads
 * proposals as input. Any BD may propose, so nothing here is admin-gated; the admin gate belongs on resolution.
 * No I/O: the DB glue is absorptionDb.ts, which gathers the facts these functions judge.
 */
import { parseDbTimestamp } from "@/lib/db/timestamp";
import { isUuid } from "@/lib/uuid";

export const ABSORPTION_STATUSES = ["open", "applied", "rejected", "withdrawn"] as const;
export type AbsorptionStatus = (typeof ABSORPTION_STATUSES)[number];

/** Free text in the column (the repo's no-CHECK convention), validated here at the write boundary. */
export const isAbsorptionStatus = (value: unknown): value is AbsorptionStatus =>
  typeof value === "string" && (ABSORPTION_STATUSES as readonly string[]).includes(value);

const TRANSITIONS: Readonly<Record<AbsorptionStatus, readonly AbsorptionStatus[]>> = {
  open: ["applied", "rejected", "withdrawn"],
  applied: [],
  rejected: [],
  withdrawn: [],
};

/**
 * Only an open proposal can be resolved; applied, rejected and withdrawn are final. `withdrawn` is the PROPOSER taking
 * their own proposal back; it is deliberately not `rejected`, which is the owner's verdict that the two companies are
 * not the same. The history must keep telling them apart.
 */
export const canTransition = (from: AbsorptionStatus, to: AbsorptionStatus): boolean => TRANSITIONS[from].includes(to);

export const ABSORPTION_NOTE_MAX = 1000;

export interface ValidProposal {
  absorbedKey: string;
  survivorKey: string;
  proposerBdId: string;
  note: string | null;
}

export type InputRefusal = "invalid_company_key" | "same_company" | "proposer_not_bd" | "invalid_note" | "note_too_long";

/** Shape checks that need no database. Keys are `company.company_key` values, matched exactly (never normalized). */
export function checkProposalInput(raw: {
  absorbedKey: unknown;
  survivorKey: unknown;
  proposerBdId: unknown;
  note?: unknown;
}): { ok: true; value: ValidProposal } | { ok: false; reason: InputRefusal } {
  const { absorbedKey, survivorKey, proposerBdId, note } = raw;
  if (typeof proposerBdId !== "string" || !isUuid(proposerBdId)) return { ok: false, reason: "proposer_not_bd" };
  if (typeof absorbedKey !== "string" || !absorbedKey || typeof survivorKey !== "string" || !survivorKey) {
    return { ok: false, reason: "invalid_company_key" };
  }
  if (absorbedKey === survivorKey) return { ok: false, reason: "same_company" };
  if (note !== undefined && note !== null && typeof note !== "string") return { ok: false, reason: "invalid_note" };
  const trimmed = typeof note === "string" ? note.trim() : "";
  if (trimmed.length > ABSORPTION_NOTE_MAX) return { ok: false, reason: "note_too_long" };
  return { ok: true, value: { absorbedKey, survivorKey, proposerBdId, note: trimmed || null } };
}

/** What the database says about a proposal's keys, gathered in one query by absorptionDb.ts. */
export interface ProposalFacts {
  proposerIsBd: boolean;
  absorbedExists: boolean;
  survivorExists: boolean;
  /** Id of the open proposal that already has the absorbed company on its absorbed side, if any. */
  openForAbsorbedId: string | null;
  /** Id of the open proposal that has the SURVIVOR on its absorbed side (the survivor is itself going away). */
  openForSurvivorId: string | null;
}

export type ProposalRefusal = "proposer_not_bd" | "absorbed_not_found" | "survivor_not_found" | "already_proposed" | "survivor_is_absorbed";

export type ProposalDecision =
  | ({ ok: true } & Pick<ValidProposal, "absorbedKey" | "survivorKey" | "note">)
  | { ok: false; reason: ProposalRefusal; openProposalId?: string };

/** `already_proposed` hands back the existing proposal's id: a second proposal means two people saw the same thing. */
export function decideProposal(p: ValidProposal, f: ProposalFacts): ProposalDecision {
  if (!f.proposerIsBd) return { ok: false, reason: "proposer_not_bd" };
  if (!f.absorbedExists) return { ok: false, reason: "absorbed_not_found" };
  if (!f.survivorExists) return { ok: false, reason: "survivor_not_found" };
  if (f.openForAbsorbedId) return { ok: false, reason: "already_proposed", openProposalId: f.openForAbsorbedId };
  if (f.openForSurvivorId) return { ok: false, reason: "survivor_is_absorbed", openProposalId: f.openForSurvivorId };
  return { ok: true, absorbedKey: p.absorbedKey, survivorKey: p.survivorKey, note: p.note };
}

/** One row of the owner's read, after normalization. Timestamps and aggregates come back from raw SQL as strings. */
export interface OpenProposalRow {
  id: string;
  note: string | null;
  created_at: Date | string;
  proposer_id: string;
  proposer_name: string;
  absorbed_key: string;
  absorbed_name: string;
  absorbed_stage: string | null;
  absorbed_domain: string | null;
  absorbed_contacts: number | string;
  absorbed_owner: string | null;
  absorbed_last_activity: Date | string | null;
  survivor_key: string;
  survivor_name: string;
  survivor_stage: string | null;
  survivor_domain: string | null;
  survivor_contacts: number | string;
  survivor_owner: string | null;
  survivor_last_activity: Date | string | null;
  total: number | string;
}

export interface ProposalCompanyView {
  key: string;
  displayName: string;
  stage: string | null;
  domain: string | null;
  contacts: number;
  ownerName: string | null;
  /** Effective activity time (direct or through a contact); null when the company has none. */
  lastActivityAt: Date | null;
}

export interface OpenProposalView {
  id: string;
  absorbed: ProposalCompanyView;
  survivor: ProposalCompanyView;
  proposedBy: { id: string; name: string };
  createdAt: Date;
  note: string | null;
  /** Open proposals in total (not just this page), for pagination. */
  total: number;
}

export function toOpenProposalView(r: OpenProposalRow): OpenProposalView {
  return {
    id: r.id,
    absorbed: {
      key: r.absorbed_key, displayName: r.absorbed_name, stage: r.absorbed_stage, domain: r.absorbed_domain,
      contacts: Number(r.absorbed_contacts), ownerName: r.absorbed_owner,
      lastActivityAt: r.absorbed_last_activity ? parseDbTimestamp(r.absorbed_last_activity) : null,
    },
    survivor: {
      key: r.survivor_key, displayName: r.survivor_name, stage: r.survivor_stage, domain: r.survivor_domain,
      contacts: Number(r.survivor_contacts), ownerName: r.survivor_owner,
      lastActivityAt: r.survivor_last_activity ? parseDbTimestamp(r.survivor_last_activity) : null,
    },
    proposedBy: { id: r.proposer_id, name: r.proposer_name },
    createdAt: parseDbTimestamp(r.created_at),
    note: r.note,
    total: Number(r.total),
  };
}

/** What the database says about the proposal someone wants to withdraw; `null` when no such row exists. */
export interface WithdrawFacts {
  status: string;
  proposedByBdId: string;
}

export type WithdrawRefusal = "proposal_not_found" | "not_open" | "not_proposer";

/**
 * Only the proposer may withdraw, and only while the proposal is open. Status is judged first: a proposal that is
 * already resolved is "not open" for everyone, so the message never blames the person for a fact about the row.
 * absorptionDb.ts enforces the same two conditions in the UPDATE's WHERE clause (the atomic guard); this function
 * only explains a refusal.
 */
export function decideWithdrawal(f: WithdrawFacts | null, actorBdId: string): { ok: true } | { ok: false; reason: WithdrawRefusal } {
  if (!f) return { ok: false, reason: "proposal_not_found" };
  if (!isAbsorptionStatus(f.status) || !canTransition(f.status, "withdrawn")) return { ok: false, reason: "not_open" };
  if (f.proposedByBdId !== actorBdId) return { ok: false, reason: "not_proposer" };
  return { ok: true };
}

/** Dictionary key (`companyRecord`) for every refusal the record page can show. Exhaustive by construction. */
export const ABSORPTION_REFUSAL_KEY = {
  invalid_company_key: "absorbRefusalInvalidCompany",
  same_company: "absorbRefusalSameCompany",
  proposer_not_bd: "absorbRefusalNotBd",
  invalid_note: "absorbRefusalInvalidNote",
  note_too_long: "absorbRefusalNoteTooLong",
  absorbed_not_found: "absorbRefusalAbsorbedNotFound",
  survivor_not_found: "absorbRefusalSurvivorNotFound",
  already_proposed: "absorbRefusalAlreadyProposed",
  survivor_is_absorbed: "absorbRefusalSurvivorIsAbsorbed",
  proposal_not_found: "absorbWithdrawNotFound",
  not_open: "absorbWithdrawNotOpen",
  not_proposer: "absorbWithdrawNotProposer",
} as const satisfies Record<InputRefusal | ProposalRefusal | WithdrawRefusal, string>;

export type AbsorptionRefusalKey = (typeof ABSORPTION_REFUSAL_KEY)[keyof typeof ABSORPTION_REFUSAL_KEY];

export const CANDIDATE_MIN_CHARS = 2;
export const CANDIDATE_QUERY_MAX = 80;
/** The picker never shows more than this many companies: the BD refines the search, not a long list. */
export const CANDIDATE_MAX = 8;

/** Trims and collapses whitespace; `null` when the text is too short to search (no query is worth running). */
export function normalizeCandidateQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.trim().replace(/\s+/g, " ").slice(0, CANDIDATE_QUERY_MAX).trim();
  return q.length >= CANDIDATE_MIN_CHARS ? q : null;
}

export interface CandidateRow {
  company_key: string;
  display_name: string;
  relationship_stage: string | null;
  domain: string | null;
  contacts: number | string;
}

export interface CandidateView {
  key: string;
  displayName: string;
  stage: string | null;
  domain: string | null;
  contacts: number;
}

export const toCandidateView = (r: CandidateRow): CandidateView => ({
  key: r.company_key,
  displayName: r.display_name,
  stage: r.relationship_stage,
  domain: r.domain,
  contacts: Number(r.contacts),
});

/** What the record page needs to show an open proposal on the absorbed company. Serializable (ISO string, no Date). */
export interface OpenNoticeRow {
  id: string;
  created_at: Date | string;
  proposer_id: string;
  proposer_name: string;
  survivor_key: string;
  survivor_name: string;
}

export interface OpenNoticeView {
  id: string;
  survivorKey: string;
  survivorName: string;
  proposerId: string;
  proposerName: string;
  createdAt: Date;
}

export const toOpenNoticeView = (r: OpenNoticeRow): OpenNoticeView => ({
  id: r.id,
  survivorKey: r.survivor_key,
  survivorName: r.survivor_name,
  proposerId: r.proposer_id,
  proposerName: r.proposer_name,
  createdAt: parseDbTimestamp(r.created_at),
});

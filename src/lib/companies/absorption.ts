/**
 * Pure decisions for "this company was absorbed by that one" proposals (table `company_absorption_proposal`).
 * A proposal is a SUGGESTION: the merge itself stays owner-only (scripts/merge-companies.ts) and never reads
 * proposals as input. Any BD may propose, so nothing here is admin-gated; the admin gate belongs on resolution.
 * No I/O: the DB glue is absorptionDb.ts, which gathers the facts these functions judge.
 */
import { isUuid } from "@/lib/uuid";

export const ABSORPTION_STATUSES = ["open", "applied", "rejected"] as const;
export type AbsorptionStatus = (typeof ABSORPTION_STATUSES)[number];

/** Free text in the column (the repo's no-CHECK convention), validated here at the write boundary. */
export const isAbsorptionStatus = (value: unknown): value is AbsorptionStatus =>
  typeof value === "string" && (ABSORPTION_STATUSES as readonly string[]).includes(value);

const TRANSITIONS: Readonly<Record<AbsorptionStatus, readonly AbsorptionStatus[]>> = {
  open: ["applied", "rejected"],
  applied: [],
  rejected: [],
};

/** Only an open proposal can be resolved; applied and rejected are final. */
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
  survivor_key: string;
  survivor_name: string;
  survivor_stage: string | null;
  survivor_domain: string | null;
  survivor_contacts: number | string;
  total: number | string;
}

export interface ProposalCompanyView {
  key: string;
  displayName: string;
  stage: string | null;
  domain: string | null;
  contacts: number;
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
    absorbed: { key: r.absorbed_key, displayName: r.absorbed_name, stage: r.absorbed_stage, domain: r.absorbed_domain, contacts: Number(r.absorbed_contacts) },
    survivor: { key: r.survivor_key, displayName: r.survivor_name, stage: r.survivor_stage, domain: r.survivor_domain, contacts: Number(r.survivor_contacts) },
    proposedBy: { id: r.proposer_id, name: r.proposer_name },
    createdAt: new Date(r.created_at),
    note: r.note,
    total: Number(r.total),
  };
}

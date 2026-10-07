/**
 * Pure side of how scripts/merge-companies.ts relates to open `company_absorption_proposal` rows. A proposal is a
 * suggestion, never an instruction: groups always come from the owner's explicit input, and this only classifies
 * which open proposals those groups happen to fulfil (to mark them applied) or contradict (to warn about).
 */
import type { MergeGroup } from "./plan";

export interface OpenProposalRef {
  id: string;
  absorbedKey: string;
  survivorKey: string;
}

export type DivergenceReason = "absorbed_into_other" | "survivor_merged_away" | "absorbed_is_survivor";

export interface ProposalMatches {
  /** Same absorbed company, same survivor: marked applied when the merge executes. */
  matched: OpenProposalRef[];
  /** Touches a planned key but says something else; left untouched and reported. */
  divergent: (OpenProposalRef & { reason: DivergenceReason })[];
}

export function matchProposalsToGroups(groups: readonly MergeGroup[], open: readonly OpenProposalRef[]): ProposalMatches {
  const survivorOfDead = new Map(groups.flatMap((g) => g.deadKeys.map((d) => [d, g.survivorKey] as const)));
  const survivors = new Set(groups.map((g) => g.survivorKey));
  const matched: OpenProposalRef[] = [];
  const divergent: ProposalMatches["divergent"] = [];
  for (const proposal of open) {
    const plannedSurvivor = survivorOfDead.get(proposal.absorbedKey);
    if (plannedSurvivor === proposal.survivorKey) matched.push({ ...proposal });
    else if (plannedSurvivor !== undefined) divergent.push({ ...proposal, reason: "absorbed_into_other" });
    else if (survivorOfDead.has(proposal.survivorKey)) divergent.push({ ...proposal, reason: "survivor_merged_away" });
    else if (survivors.has(proposal.absorbedKey)) divergent.push({ ...proposal, reason: "absorbed_is_survivor" });
  }
  return { matched, divergent };
}

/** Thrown inside executeMerge's transaction, before any write, when the proposal it was asked to fulfil is no longer open. */
export class ProposalNotOpenError extends Error {
  constructor(id: string) {
    super(`Proposal ${id} is no longer open. Nothing was written.`);
  }
}

export function assertProposalMatched(matched: readonly OpenProposalRef[], id: string): void {
  if (!matched.some((m) => m.id === id)) throw new ProposalNotOpenError(id);
}

/**
 * Pure catch-up planner (task 4B.7; design.md "Catch-up (owner D4b)";
 * contact-migration spec "Incremental catch-up run"). Builds the identity
 * write plan for the catch-up run's input: legacy `contact`/`lead` rows with
 * no `person_id_map` entry yet (anti-join, queried by
 * scripts/unify-contacts.ts --phase=catch_up, task 4B.8), plus already-mapped
 * rows that drifted since the run that mapped them (design: leads by
 * `updated_at`, contacts via the existing diff core) — the caller decides
 * which rows qualify and passes them in the SAME shape as anti-join rows, so
 * this planner treats "never mapped" and "drifted" identically.
 *
 * Reuses `planIdentityWrites` (design D12: "one shared resolver ... used by
 * live paths AND catch-up") and the exact same legacy-row -> IdentityIngestRow
 * mappers the live write cutover uses (./ingestWrite.ts's
 * contactRowsToIdentityRows/leadRowsToIdentityRows), so catch-up can never
 * drift from live-path field mapping or from the live-path's own-owner
 * decision below.
 *
 * A drifted row that still resolves to the SAME person (same profile key or
 * verified email) is planned as an "auto" update that merges its new field
 * values in — no special-casing needed, planIdentityWrites already does
 * this for any row whose identity keys match an existing person.
 *
 * Leads with no resolved owner are excluded here too (same decision
 * ingestWrite.ts's leadRowsToIdentityRows already makes for live ingestion):
 * `bdId` is required for `person_bd_connection` (design D2), and an
 * owner-less lead has nothing to connect. They stay unmapped and are picked
 * up by the NEXT catch-up run once `updateLeadOwner` assigns one —
 * `leadsSkippedNoOwner` reports how many were excluded this run.
 */
import {
  contactRowsToIdentityRows,
  leadRowsToIdentityRows,
  type InsertedContactRow,
  type InsertedLeadRow,
} from "@/lib/identity/ingestWrite";
import {
  planIdentityWrites,
  type ExistingPersonCandidate,
  type IdentityWritePlan,
} from "@/lib/identity/resolve";
import { computeCatchUpInputHash } from "./inputHash";

export type CatchUpContactRow = InsertedContactRow;
export type CatchUpLeadRow = InsertedLeadRow;

export interface CatchUpInput {
  contacts: readonly CatchUpContactRow[];
  leads: readonly CatchUpLeadRow[];
}

export interface CatchUpPlan {
  plan: IdentityWritePlan;
  /** Leads excluded from `plan` this run because they have no owner yet. */
  leadsSkippedNoOwner: number;
  /** Reflective fingerprint over every input row and the existing-person
   * snapshot the plan was matched against (design.md "Migration plan":
   * `--execute` "refuses if `input_hash` changed"). */
  inputHash: string;
}

export function planCatchUp(
  input: CatchUpInput,
  existingPersons: readonly ExistingPersonCandidate[],
): CatchUpPlan {
  const identityRows = [
    ...contactRowsToIdentityRows(input.contacts),
    ...leadRowsToIdentityRows(input.leads),
  ];

  return {
    plan: planIdentityWrites(identityRows, existingPersons),
    leadsSkippedNoOwner: input.leads.filter((l) => l.ownerBdId == null).length,
    inputHash: computeCatchUpInputHash(input.contacts, input.leads, existingPersons),
  };
}

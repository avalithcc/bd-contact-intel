/**
 * Short, explicit, hand-verified, person-id-keyed manual overrides for
 * scripts/backfill-split-remaining-stuffed-names.ts (owner ask, 2026-09-30).
 * Matched by EXACT person id, NEVER by the name text itself — same
 * convention as stuffedNameSplitBackfill.ts#OWNER_EXCLUDED_PERSON_IDS.
 * Checked FIRST in buildFirstTokenSplitPlan, before both the LinkedIn
 * cleanup and the safety gate — a hand-verified correction is never
 * second-guessed by either.
 *
 * A field left `undefined` means "leave it exactly as currently stored" —
 * only the "Smart Gen" override needs this (it only ever touches
 * first_name); the write always sets BOTH first_name and last_name columns,
 * so `resolveManualOverrideFill` fills in the candidate's own current value
 * for any field the override doesn't specify, making that column a
 * documented no-op rather than an accidental clear.
 */
import type { StuffedNameSplitCandidate } from "./stuffedNameSplitBackfill";

export interface FirstTokenSplitManualOverride {
  personId: string;
  firstName?: string | null;
  lastName?: string | null;
  /** Only set for the "create a company and link it" override — see
   * resolveManualOverrideFill and the script's company-creation handling. */
  createCompanyDisplayName?: string;
}

export const FIRST_TOKEN_SPLIT_MANUAL_OVERRIDES: readonly FirstTokenSplitManualOverride[] = [
  // "Kimberly West-Philips, SHRM-CP" — exactly what the comma-drop rule
  // would produce, but the row is gate-excluded (junk_punctuation) because
  // the original classifier tokenizes on whitespace only, so ANY comma
  // fails its charset check before ambiguous_3/ambiguous_many is ever
  // reached (documented tradeoff in stuffedNameFirstTokenSplit.ts). Owner
  // confirmed this exact split by hand.
  {
    personId: "124682bb-c7d0-4fa1-a794-a575ff0641c0",
    firstName: "Kimberly",
    lastName: "West-Philips",
  },
  // "Sandra (Garay) Vallejos" — a parenthesized maiden name; no rule here
  // handles parentheses, so this is a straight hand-verified correction.
  {
    personId: "7bfca812-5206-41a7-8c6e-b415d21be307",
    firstName: "Sandra",
    lastName: "Garay Vallejos",
  },
  // "Contacto de 2º grado2º V" — LinkedIn connection-degree UI text leaked
  // into first_name with no real name in it at all. A REAL person (VP
  // Engineering at Belvo, email gciotta@gmail.com) — owner inferred the
  // surname "Ciotta" from the email's local part ("g" + "ciotta").
  {
    personId: "8027060c-9793-42a6-8f34-bc1e34a54d5d",
    firstName: null,
    lastName: "Ciotta",
  },
  // "Smart Gen" — NOT a person (email nextgenshopseo@gmail.com, no company
  // on file). Previously OWNER_EXCLUDED_PERSON_IDS in
  // stuffedNameSplitBackfill.ts for exactly this reason. Owner now wants a
  // brand-new `company` "Smart Gen" created and linked instead of leaving
  // the row alone — see resolveManualOverrideFill's `createCompany` and the
  // script's company-creation/link handling. `lastName` deliberately
  // omitted (left unchanged) — only first_name is a stuffed non-person
  // value here.
  {
    personId: "add5bf2d-6671-4a87-8254-bb3953699afb",
    firstName: null,
    createCompanyDisplayName: "Smart Gen",
  },
];

export function findFirstTokenSplitManualOverride(personId: string): FirstTokenSplitManualOverride | null {
  return FIRST_TOKEN_SPLIT_MANUAL_OVERRIDES.find((o) => o.personId === personId) ?? null;
}

export interface FirstTokenSplitManualOverrideFill {
  personId: string;
  originalFirstName: string;
  originalLastName: string | null;
  firstName: string | null;
  lastName: string | null;
  rule: "manual_override";
  createCompany?: { displayName: string };
}

type OverrideCandidate = Pick<StuffedNameSplitCandidate, "personId" | "firstName" | "originalLastName">;

/**
 * Folds a manual override + the candidate's CURRENTLY-READ row into a
 * concrete fill plan item. Pure — never mutates `candidate` or `override`;
 * safe to call twice with the same input for the same result (see
 * tests/unit/stuffedNameFirstTokenSplitOverrides.test.ts).
 */
export function resolveManualOverrideFill(
  candidate: OverrideCandidate,
  override: FirstTokenSplitManualOverride,
): FirstTokenSplitManualOverrideFill {
  const fill: FirstTokenSplitManualOverrideFill = {
    personId: candidate.personId,
    originalFirstName: candidate.firstName,
    originalLastName: candidate.originalLastName,
    firstName: override.firstName !== undefined ? override.firstName : candidate.firstName,
    lastName: override.lastName !== undefined ? override.lastName : candidate.originalLastName,
    rule: "manual_override",
  };
  if (override.createCompanyDisplayName) {
    fill.createCompany = { displayName: override.createCompanyDisplayName };
  }
  return fill;
}

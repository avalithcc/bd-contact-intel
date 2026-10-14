/**
 * Per-Contact roster accept/reject. Pure: every guard runs here and the caller never drops a Contact silently, each
 * rejected one comes back with a reason code. Enforced server-side on add, bulk add and re-admit.
 */
import { isSuppressed, type SuppressionRule } from "./suppression";

export const COMPANY_MEMBER_LIMIT = 2;

export type RosterRejection = "unreachable" | "company_limit" | "client" | "suppressed" | "duplicate";

export interface RosterCandidate {
  personId: string;
  email: string | null;
  emailStatus: string;
  emailSource: string | null;
  mergedIntoId: string | null;
  companyKey: string | null;
  /** company.client_status. ANY non-empty value ('active' or 'inactive') means the company is a client. */
  clientStatus: string | null;
}

export interface RosterContext {
  suppressionRules: readonly SuppressionRule[];
  /** Persons already on this Sequence (any state). */
  existingPersonIds: ReadonlySet<string>;
  /** Non-discarded members per person.company_key. Discarded members must not be counted by the caller. */
  activeCountByCompany: ReadonlyMap<string, number>;
}

export interface RosterDecision {
  accepted: string[];
  rejected: { personId: string; reason: RosterRejection }[];
}

export function isReachable(c: RosterCandidate): boolean {
  return !c.mergedIntoId && !!c.email?.trim() && c.emailStatus !== "none" && c.emailSource !== "pattern_inferred";
}

/** Stateless guards (everything except duplicate and the company limit), shared with re-admission. */
export function staticRosterRejection(c: RosterCandidate, rules: readonly SuppressionRule[]): RosterRejection | null {
  if (!isReachable(c)) return "unreachable";
  if (c.clientStatus) return "client";
  if (isSuppressed(c.email as string, rules)) return "suppressed";
  return null;
}

export function evaluateRosterAdds(candidates: readonly RosterCandidate[], ctx: RosterContext): RosterDecision {
  const result: RosterDecision = { accepted: [], rejected: [] };
  const seen = new Set(ctx.existingPersonIds);
  const counts = new Map(ctx.activeCountByCompany);
  for (const c of candidates) {
    const reject = (reason: RosterRejection) => result.rejected.push({ personId: c.personId, reason });
    if (seen.has(c.personId)) {
      reject("duplicate");
      continue;
    }
    const staticReason = staticRosterRejection(c, ctx.suppressionRules);
    if (staticReason) {
      reject(staticReason);
      continue;
    }
    if (c.companyKey && (counts.get(c.companyKey) ?? 0) >= COMPANY_MEMBER_LIMIT) {
      reject("company_limit");
      continue;
    }
    seen.add(c.personId);
    if (c.companyKey) counts.set(c.companyKey, (counts.get(c.companyKey) ?? 0) + 1);
    result.accepted.push(c.personId);
  }
  return result;
}

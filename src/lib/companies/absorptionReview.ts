/**
 * Pure decisions for the owner's absorption review queue (/admin/absorptions). No I/O: the DB glue is
 * absorptionDb.ts (reads and the reject UPDATE) and companyMerge/db.ts#executeMerge (the merge itself).
 */
import { canTransition, isAbsorptionStatus } from "@/lib/companies/absorption";
import { REFUSAL_PREFIX, strongestStage } from "@/lib/companyMerge/plan";
import type { MergeGroup } from "@/lib/companyMerge/plan";
import { matchProposalsToGroups } from "@/lib/companyMerge/proposals";
import type { OpenProposalView } from "@/lib/companies/absorption";

/** What the apply action re-reads from the database, so nothing the client posts decides what gets merged. */
export interface ResolutionFacts {
  status: string;
  /** NULL once the absorbed company is gone (the FK is SET NULL). */
  absorbedKey: string | null;
  survivorKey: string;
  /** The absorbed company's LIVE display name, not the snapshot taken when the proposal was made. */
  absorbedName: string | null;
}

/** Unicode-composed, whitespace runs collapsed, trimmed. Still case-sensitive: it is the brake on an irreversible merge. */
const canonical = (s: string): string => s.normalize("NFC").replace(/\s+/g, " ").trim();

/** Compares in canonical form so a name stored decomposed (NFD, common in imports) can still be typed on a keyboard. */
export const confirmationMatches = (typed: unknown, expected: string): boolean =>
  typeof typed === "string" && canonical(expected) !== "" && canonical(typed) === canonical(expected);

export type ApplyDecision = { ok: true; group: MergeGroup } | { ok: false; code: "not_open" | "name_mismatch" };

/** Status is judged before the name: a proposal someone else already resolved is "not open" whatever was typed. */
export function decideApply(f: ResolutionFacts | null, typed: unknown): ApplyDecision {
  if (!f || !f.absorbedKey || f.absorbedName === null || !isAbsorptionStatus(f.status) || !canTransition(f.status, "applied")) {
    return { ok: false, code: "not_open" };
  }
  if (!confirmationMatches(typed, f.absorbedName)) return { ok: false, code: "name_mismatch" };
  return { ok: true, group: { survivorKey: f.survivorKey, deadKeys: [f.absorbedKey] } };
}

export const DETAIL_MAX = 600;

/** executeMerge throws `Refusing to execute:\n- reason\n- reason` on blockers; anything else is not a blocker. */
export function blockerDetail(err: unknown): string | null {
  if (!(err instanceof Error) || !err.message.startsWith(REFUSAL_PREFIX)) return null;
  const reasons = err.message.slice(REFUSAL_PREFIX.length).split("\n").map((l) => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean);
  return reasons.join(" · ").slice(0, DETAIL_MAX);
}

/** The redirect `?result=` vocabulary. The tone decides the alert, so a refusal can never render as success. */
export const REVIEW_CODES = ["applied", "rejected", "invalid_id", "not_open", "name_mismatch", "blocked", "failed"] as const;
export type ReviewCode = (typeof REVIEW_CODES)[number];
export type ReviewOutcome = { code: ReviewCode; detail?: string };

const TONES: Record<ReviewCode, "success" | "warn" | "danger"> = {
  applied: "success",
  rejected: "success",
  invalid_id: "warn",
  not_open: "warn",
  name_mismatch: "warn",
  blocked: "danger",
  failed: "danger",
};
export const outcomeTone = (code: ReviewCode) => TONES[code];

export function parseOutcome(sp: { result?: string; detail?: string }): ReviewOutcome | null {
  const code = REVIEW_CODES.find((c) => c === sp.result);
  if (!code) return null;
  return code === "blocked" && sp.detail ? { code, detail: sp.detail.slice(0, DETAIL_MAX) } : { code };
}

const blank = (v: string | null) => v === null || v.trim() === "";
export type Side = "absorbed" | "survivor" | null;

/** Who donates the value that ends up on the survivor: its own when it has one, else the absorbed company's. */
export const keptSide = (absorbed: string | null, survivor: string | null): Side =>
  !blank(survivor) ? "survivor" : !blank(absorbed) ? "absorbed" : null;

/** The stronger stage wins (a `won` survives whichever record does); a tie keeps the survivor's, as the merge does. */
export function keptStage(absorbed: string | null, survivor: string | null): Side {
  const kept = strongestStage(survivor, absorbed);
  return kept === null ? null : kept === survivor ? "survivor" : "absorbed";
}

/**
 * The other open proposals that applying this one destroys: their survivor FK is ON DELETE CASCADE, so one that names
 * the absorbed company as its survivor is deleted with it. Classified by the merge engine's own matcher, over the
 * proposals already on screen (no extra read). A proposal that merely absorbs the survivor is untouched.
 */
export function proposalsLostByApplying(selected: OpenProposalView, open: readonly OpenProposalView[]): OpenProposalView[] {
  const refs = open.map((p) => ({ id: p.id, absorbedKey: p.absorbed.key, survivorKey: p.survivor.key }));
  const group = { survivorKey: selected.survivor.key, deadKeys: [selected.absorbed.key] };
  const lost = new Set(matchProposalsToGroups([group], refs).divergent.filter((d) => d.reason !== "absorbed_is_survivor").map((d) => d.id));
  return open.filter((p) => lost.has(p.id));
}

/**
 * Pure decisions for the owner's absorption review queue (/admin/absorptions). No I/O: the DB glue is
 * absorptionDb.ts (reads and the reject UPDATE) and companyMerge/db.ts#executeMerge (the merge itself).
 */
import { canTransition, isAbsorptionStatus } from "@/lib/companies/absorption";
import { strongestStage } from "@/lib/companyMerge/plan";
import type { MergeGroup } from "@/lib/companyMerge/plan";

/** What the apply action re-reads from the database, so nothing the client posts decides what gets merged. */
export interface ResolutionFacts {
  status: string;
  /** NULL once the absorbed company is gone (the FK is SET NULL). */
  absorbedKey: string | null;
  survivorKey: string;
  /** The absorbed company's LIVE display name, not the snapshot taken when the proposal was made. */
  absorbedName: string | null;
}

/** Exact match after trimming: this is the brake on an irreversible merge, so no case folding. */
export const confirmationMatches = (typed: unknown, expected: string): boolean =>
  typeof typed === "string" && expected.trim() !== "" && typed.trim() === expected.trim();

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
const BLOCKER_PREFIX = "Refusing to execute:";

/** executeMerge throws `Refusing to execute:\n- reason\n- reason` on blockers; anything else is not a blocker. */
export function blockerDetail(err: unknown): string | null {
  if (!(err instanceof Error) || !err.message.startsWith(BLOCKER_PREFIX)) return null;
  const reasons = err.message.slice(BLOCKER_PREFIX.length).split("\n").map((l) => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean);
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

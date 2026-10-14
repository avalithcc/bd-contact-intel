// Global daily credit ceiling for Lusha, in credits, defined in exactly one
// place. Pure: callers pass the credits already spent today (summed from our
// own ledger, never from Lusha's eventually-consistent usage endpoint).

export const DEFAULT_DAILY_CREDIT_CAP = 12;

/**
 * Parses the raw LUSHA_DAILY_CREDIT_CAP value. Anything that is not a plain
 * non-negative integer falls back to the default, so a typo can never turn
 * into an unbounded ceiling. "0" is valid: a soft kill switch.
 */
export function parseDailyCreditCap(raw: string | undefined): number {
  const text = (raw ?? "").trim();
  if (!/^\d+$/.test(text)) return DEFAULT_DAILY_CREDIT_CAP;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : DEFAULT_DAILY_CREDIT_CAP;
}

export function getDailyCreditCap(env: Record<string, string | undefined> = process.env): number {
  return parseDailyCreditCap(env.LUSHA_DAILY_CREDIT_CAP);
}

export interface CapInput {
  spentToday: number;
  cap: number;
  expected: number;
}

export interface CapDecision {
  allowed: boolean;
  /** Credits left today before this action, never negative. */
  remaining: number;
}

/** Allowed when spent plus expected stays at or under the ceiling. */
export function evaluateCap({ spentToday, cap, expected }: CapInput): CapDecision {
  return {
    allowed: spentToday + expected <= cap,
    remaining: Math.max(0, cap - spentToday),
  };
}

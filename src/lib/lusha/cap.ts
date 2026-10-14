// Global daily credit ceiling for Lusha, in credits, defined in exactly one
// place. Pure: callers pass the credits already spent today (summed from our
// own ledger, never from Lusha's eventually-consistent usage endpoint).

export const DEFAULT_DAILY_CREDIT_CAP = 12;

export type CapSource = "default" | "env" | "invalid";

export interface CapResolution {
  cap: number;
  /** Why the cap has this value. Never carries the raw value. */
  source: CapSource;
}

/**
 * Resolves the raw LUSHA_DAILY_CREDIT_CAP value. Unset or blank means the
 * default. A value that IS set but is not a plain non-negative integer
 * resolves to 0 (feature visibly dead): a wrongly permissive ceiling is money
 * gone, a dead feature is noticed within minutes. "0" is the soft kill switch.
 */
export function resolveDailyCreditCap(raw: string | undefined): CapResolution {
  const text = (raw ?? "").trim();
  if (text === "") return { cap: DEFAULT_DAILY_CREDIT_CAP, source: "default" };
  if (!/^\d+$/.test(text)) return { cap: 0, source: "invalid" };
  const value = Number(text);
  return Number.isSafeInteger(value) ? { cap: value, source: "env" } : { cap: 0, source: "invalid" };
}

export function parseDailyCreditCap(raw: string | undefined): number {
  return resolveDailyCreditCap(raw).cap;
}

export function getDailyCreditCap(env: Record<string, string | undefined> = process.env): number {
  return parseDailyCreditCap(env.LUSHA_DAILY_CREDIT_CAP);
}

/** Same as getDailyCreditCap, plus the reason, so a dead cap is debuggable. */
export function getDailyCreditCapResolution(
  env: Record<string, string | undefined> = process.env,
): CapResolution {
  return resolveDailyCreditCap(env.LUSHA_DAILY_CREDIT_CAP);
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

const isCredits = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;

/** Allowed when spent plus expected stays at or under the ceiling. Any input that is
 * not a non-negative safe integer is refused with nothing remaining. */
export function evaluateCap({ spentToday, cap, expected }: CapInput): CapDecision {
  // Fail closed: DB aggregates arrive as strings or null, and null + 2 <= 12 would allow a spend.
  if (![spentToday, cap, expected].every(isCredits)) return { allowed: false, remaining: 0 };
  return {
    allowed: spentToday + expected <= cap,
    remaining: Math.max(0, cap - spentToday),
  };
}

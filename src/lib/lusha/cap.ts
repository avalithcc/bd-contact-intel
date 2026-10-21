// Global Lusha credit ceilings, in credits, defined in exactly one place: a MONTHLY cap tied to the Lusha billing
// cycle (the budget) and a DAILY cap (a runaway rail). A reservation must pass BOTH. Pure: callers pass the credits
// already spent (summed from our own ledger, never from Lusha's eventually-consistent usage endpoint).

import { addDaysToDateString, argentinaCalendarDate, argentinaInstantBoundary } from "@/lib/tasks/argentinaDate";
import { SEARCH_COST, expectedCost, type CanRevealEntry, type LushaField } from "./pricing";

// A runaway rail, not a budget: more than triple the busiest real day (12 credits), low enough that a loop or a bad
// bulk (a phone reveal is 5 credits) is stopped within an afternoon. The budget is the monthly cap.
export const DEFAULT_DAILY_CREDIT_CAP = 60;
/** The plan size: Lusha replenishes this many credits each billing cycle. */
export const DEFAULT_MONTHLY_CREDIT_CAP = 400;
/**
 * Only a placeholder, never a working default: an UNSET cycle day makes the monthly cap 0 (see getLushaLimits), so
 * the feature is visibly dead until someone sets LUSHA_CYCLE_START_DAY. Production sets 21, the day the Lusha plan
 * renews. Defaulting to 1 (the calendar month) would be the one failure that LOSES MONEY silently: the counter would
 * reset on the 1st while Lusha does not replenish until the 21st, so the CRM would report a fresh allowance that does
 * not exist. Every other value in this module fails closed; this one must too.
 */
export const DEFAULT_CYCLE_START_DAY = 1;

export type CapSource = "default" | "env" | "invalid";

export interface CapResolution {
  cap: number;
  /** Why the cap has this value. Never carries the raw value. */
  source: CapSource;
}

function resolveCredits(raw: string | undefined, fallback: number): CapResolution {
  const text = (raw ?? "").trim();
  if (text === "") return { cap: fallback, source: "default" };
  if (!/^\d+$/.test(text)) return { cap: 0, source: "invalid" };
  const value = Number(text);
  return Number.isSafeInteger(value) ? { cap: value, source: "env" } : { cap: 0, source: "invalid" };
}

/**
 * Resolves the raw LUSHA_DAILY_CREDIT_CAP value. Unset or blank means the
 * default. A value that IS set but is not a plain non-negative integer
 * resolves to 0 (feature visibly dead): a wrongly permissive ceiling is money
 * gone, a dead feature is noticed within minutes. "0" is the soft kill switch.
 */
export function resolveDailyCreditCap(raw: string | undefined): CapResolution {
  return resolveCredits(raw, DEFAULT_DAILY_CREDIT_CAP);
}

/** LUSHA_MONTHLY_CREDIT_CAP, same rules as the daily one: invalid resolves to 0 (dead), "0" is the kill switch. */
export function resolveMonthlyCreditCap(raw: string | undefined): CapResolution {
  return resolveCredits(raw, DEFAULT_MONTHLY_CREDIT_CAP);
}

/** `unset` is its own source, and not folded into `invalid`: nothing is wrong with the value, it was never given. */
export type CycleStartSource = CapSource | "unset";

export interface CycleStartResolution {
  day: number;
  source: CycleStartSource;
}

/**
 * LUSHA_CYCLE_START_DAY: the day of the month the Lusha plan renews. Only 1-28 are valid, so a cycle start can never
 * fall in a month that lacks that day. UNSET and INVALID both report a non-`env` source and getLushaLimits turns
 * either into a monthly cap of 0, so the feature is visibly dead until it is configured — the returned day is a
 * placeholder that is never used as a window. See DEFAULT_CYCLE_START_DAY for why unset must not mean "calendar month".
 */
export function resolveCycleStartDay(raw: string | undefined): CycleStartResolution {
  const text = (raw ?? "").trim();
  if (text === "") return { day: DEFAULT_CYCLE_START_DAY, source: "unset" };
  if (!/^\d{1,2}$/.test(text)) return { day: DEFAULT_CYCLE_START_DAY, source: "invalid" };
  const day = Number(text);
  return day >= 1 && day <= 28 ? { day, source: "env" } : { day: DEFAULT_CYCLE_START_DAY, source: "invalid" };
}

export interface LushaLimits {
  dailyCap: number;
  monthlyCap: number;
  cycleStartDay: number;
}

/** Every limit the reservation needs, from the environment. An invalid cycle start day kills the monthly cap. */
export function getLushaLimits(env: Record<string, string | undefined> = process.env): LushaLimits {
  const start = resolveCycleStartDay(env.LUSHA_CYCLE_START_DAY);
  const monthly = resolveMonthlyCreditCap(env.LUSHA_MONTHLY_CREDIT_CAP).cap;
  return {
    dailyCap: resolveDailyCreditCap(env.LUSHA_DAILY_CREDIT_CAP).cap,
    // Only an explicitly configured cycle day enables the monthly budget. Unset and invalid both kill it.
    monthlyCap: start.source === "env" ? monthly : 0,
    cycleStartDay: start.day,
  };
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

export interface CapsInput {
  spentToday: number;
  spentCycle: number;
  dailyCap: number;
  monthlyCap: number;
  expected: number;
}

export type CapName = "daily" | "monthly";

export type CapsDecision =
  | { allowed: true; /** Credits left before this action under the tighter of the two caps. */ remaining: number }
  | { allowed: false; blockedBy: CapName; /** Credits left under the cap that blocked. */ remaining: number };

/**
 * Allowed only when the action fits under the daily cap AND the monthly cap, and says which one refused. When both
 * refuse, the monthly one is named: it resets later, so "resets tomorrow" would be false. Any input that is not a
 * non-negative safe integer is refused with nothing remaining, attributed to the monthly cap (the conservative message).
 */
export function evaluateCaps({ spentToday, spentCycle, dailyCap, monthlyCap, expected }: CapsInput): CapsDecision {
  if (![spentToday, spentCycle, dailyCap, monthlyCap, expected].every(isCredits)) return { allowed: false, blockedBy: "monthly", remaining: 0 };
  const monthly = evaluateCap({ spentToday: spentCycle, cap: monthlyCap, expected });
  if (!monthly.allowed) return { allowed: false, blockedBy: "monthly", remaining: monthly.remaining };
  const daily = evaluateCap({ spentToday, cap: dailyCap, expected });
  if (!daily.allowed) return { allowed: false, blockedBy: "daily", remaining: daily.remaining };
  return { allowed: true, remaining: Math.min(daily.remaining, monthly.remaining) };
}

/**
 * The Argentina business day containing `now`, as real UTC instants [start, end). The ledger's `at` is a
 * real timestamp, so this uses argentinaInstantBoundary; argentinaDayBoundaries is naive 00:00 UTC and only
 * valid for task.due_at (argentinaDayBoundariesUsage.test.ts). Not Lusha's resetsAt, which tracks requests.
 */
export function artDayWindow(now: Date): { start: Date; end: Date } {
  const today = argentinaCalendarDate(now);
  return { start: argentinaInstantBoundary(today), end: argentinaInstantBoundary(addDaysToDateString(today, 1)) };
}

/**
 * The Lusha BILLING CYCLE containing `now`, as real UTC instants [start, end), for a plan that renews on `startDay`.
 *
 * It follows the billing cycle and NOT the calendar month on purpose. Lusha replenishes credits on the renewal day (the
 * 21st in production). A calendar-month window would reset our counter on 1 November while Lusha does not replenish
 * until the 21st, so the team would be allowed what was left of the old cycle PLUS a fresh 400 that does not exist, and
 * the CRM would report headroom it does not have. The cycle start is configuration (LUSHA_CYCLE_START_DAY), never read
 * from Lusha's API: spend is summed from our own ledger.
 *
 * Example, startDay 21: 2026-11-05 is in [2026-10-21, 2026-11-21); 2026-11-21 (ART) opens [2026-11-21, 2026-12-21).
 * `startDay` is 1-28 so every month has it; anything else throws (callers pass a resolved, validated value).
 */
export function lushaCycleWindow(now: Date, startDay: number): { start: Date; end: Date } {
  if (!Number.isInteger(startDay) || startDay < 1 || startDay > 28) throw new RangeError(`Lusha cycle start day must be an integer 1-28, got ${startDay}`);
  const [y, m, d] = argentinaCalendarDate(now).split("-").map(Number) as [number, number, number];
  const monthIndex = y * 12 + (m - 1) - (d >= startDay ? 0 : 1);
  const dateOf = (index: number) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-${String(startDay).padStart(2, "0")}`;
  return { start: argentinaInstantBoundary(dateOf(monthIndex)), end: argentinaInstantBoundary(dateOf(monthIndex + 1)) };
}

export type Reservation =
  | { ok: true; credits: number }
  | { ok: false; reason: "cap_exceeded"; /** Which cap refused: the daily one resets tomorrow, the monthly one on the cycle date. */ cap: CapName; remaining: number }
  | { ok: false; reason: "no_price_list" | "not_revealable" };

/**
 * What to reserve, and whether the caps allow it. `canReveal` MUST be the price list read in the same
 * transaction as the reservation. A price of 0 still reserves one credit, so a stale or free-looking
 * price can never bypass the caps (nor the cap-0 kill switch); the settle reconciles to what Lusha billed.
 */
export function planReservation(input: { field: LushaField; canReveal: readonly CanRevealEntry[] | null | undefined; spentToday: number; spentCycle: number; dailyCap: number; monthlyCap: number }): Reservation {
  const price = expectedCost(input.field, input.canReveal);
  if (!price.ok) return price;
  const credits = Math.max(SEARCH_COST, price.credits);
  const decision = evaluateCaps({ spentToday: input.spentToday, spentCycle: input.spentCycle, dailyCap: input.dailyCap, monthlyCap: input.monthlyCap, expected: credits });
  return decision.allowed ? { ok: true, credits } : { ok: false, reason: "cap_exceeded", cap: decision.blockedBy, remaining: decision.remaining };
}

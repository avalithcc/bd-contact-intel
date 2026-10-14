/** Per-day send cap for a sequence: default 5, system ceiling 15, warn above 8. */
export const DAILY_SEND_CAP_DEFAULT = 5;
export const DAILY_SEND_CAP_CEILING = 15;
export const DAILY_SEND_CAP_WARN_ABOVE = 8;

export type CapRejection = "not_a_number" | "not_integer" | "not_positive" | "above_ceiling";

export type CapValidation =
  | { ok: true; value: number; warn: boolean }
  | { ok: false; reason: CapRejection };

/** An absent value (undefined or null) resolves to the default cap. */
export function validateDailySendCap(input: unknown): CapValidation {
  if (input === undefined || input === null) {
    return { ok: true, value: DAILY_SEND_CAP_DEFAULT, warn: false };
  }
  if (typeof input !== "number" || !Number.isFinite(input)) {
    return { ok: false, reason: "not_a_number" };
  }
  if (!Number.isInteger(input)) return { ok: false, reason: "not_integer" };
  if (input < 1) return { ok: false, reason: "not_positive" };
  if (input > DAILY_SEND_CAP_CEILING) return { ok: false, reason: "above_ceiling" };
  return { ok: true, value: input, warn: input > DAILY_SEND_CAP_WARN_ABOVE };
}

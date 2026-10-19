/**
 * "Teléfono a revisar": which stored phone values the E.164 backfill (phoneNormalize.ts) could not fix. Client-safe on
 * purpose (no libphonenumber): a stored value is flagged when it is non-blank and does not have the E.164 SHAPE. That is
 * the same pattern as `E164_RE` in phoneNormalize.ts, so every value the normalizer would write back is clean, and no
 * country is ever guessed. The list filter runs the identical pattern in SQL (`!~`), see listQueries.ts.
 * A number saved through `normalizePhoneForWrite` becomes E.164 when it is valid, so the mark disappears by itself.
 */

const E164_SHAPE_RE = /^\+[1-9][0-9]{6,14}$/;

/** The same pattern as a Postgres regex string (POSIX syntax agrees with JS for this subset). */
export const E164_SHAPE_SQL_PATTERN = E164_SHAPE_RE.source;

export function phoneNeedsReview(value: string | null | undefined): boolean {
  if (value === null || value === undefined || value.trim() === "") return false;
  return !E164_SHAPE_RE.test(value);
}

export function anyPhoneNeedsReview(phone: string | null | undefined, mobilePhone: string | null | undefined): boolean {
  return phoneNeedsReview(phone) || phoneNeedsReview(mobilePhone);
}

export type PhoneReviewVariant = "no_country" | "unrecognized";

/** Which explanation fits: no leading `+` means the country is unknown; with `+` the country is there but the number did not validate. */
export function phoneReviewVariant(value: string): PhoneReviewVariant {
  return value.trim().startsWith("+") ? "unrecognized" : "no_country";
}

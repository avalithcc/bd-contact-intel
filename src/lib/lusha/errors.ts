// Typed error taxonomy for the Lusha integration. Nothing is retried
// automatically anywhere: a retry on a paid endpoint is a second charge, so
// this type carries no retry flag, backoff or attempt count.

export const LUSHA_ERROR_KINDS = [
  "bad_key",
  "no_credits",
  "plan_denied",
  "rate_limited",
  "compliance_blocked",
  "unavailable",
  "not_found",
  "compliance_restricted",
  "enrich_failed",
  "async_unsupported",
  "unparsable_value",
  "cap_exceeded",
  "busy",
] as const;

export type LushaErrorKind = (typeof LUSHA_ERROR_KINDS)[number];

export class LushaError extends Error {
  readonly kind: LushaErrorKind;

  constructor(kind: LushaErrorKind, message: string = kind) {
    super(message);
    this.name = "LushaError";
    this.kind = kind;
  }
}

/** Maps an HTTP status to a kind, or null for a success status. */
export function kindFromHttpStatus(status: number): LushaErrorKind | null {
  if (status >= 200 && status < 300) return null;
  switch (status) {
    case 401:
      return "bad_key";
    case 402:
      return "no_credits";
    case 403:
      return "plan_denied";
    case 429:
      return "rate_limited";
    case 451:
      return "compliance_blocked";
    default:
      // 5xx and anything unexpected fail closed; still never retried.
      return "unavailable";
  }
}

/**
 * Maps a per-contact code from a 200 body. WATERFALL_NOT_IN_PLAN (a partial
 * success on the free plan) and unknown codes are not errors.
 */
export function kindFromContactCode(code: string | undefined | null): LushaErrorKind | null {
  const upper = typeof code === "string" ? code.trim().toUpperCase() : "";
  // Anything that smells of compliance is permanent: a new or lowercase code
  // must never read as "no value" and invite a re-spend on a protected person.
  if (upper.includes("COMPLIANCE")) return "compliance_restricted";
  switch (upper) {
    case "NOT_FOUND":
      return "not_found";
    case "ENRICH_FAILED":
      return "enrich_failed";
    default:
      return null;
  }
}

const PERMANENT: Record<LushaErrorKind, boolean> = {
  bad_key: false,
  no_credits: false,
  plan_denied: false,
  rate_limited: false,
  compliance_blocked: true,
  unavailable: false,
  not_found: false,
  compliance_restricted: true,
  enrich_failed: false,
  async_unsupported: false,
  unparsable_value: false,
  cap_exceeded: false,
  busy: false,
};

const RETRYABLE_BY_BD: Record<LushaErrorKind, boolean> = {
  bad_key: false,
  no_credits: false,
  plan_denied: false,
  rate_limited: true,
  compliance_blocked: false,
  unavailable: true,
  not_found: true,
  compliance_restricted: false,
  enrich_failed: true,
  async_unsupported: false,
  unparsable_value: false,
  cap_exceeded: false,
  busy: true,
};

/** Only a compliance outcome is permanent (D6): protected today, protected tomorrow. */
export function isPermanent(kind: LushaErrorKind): boolean {
  return PERMANENT[kind];
}

/** Whether a BD may deliberately try again (manual, never automatic). Pass the HTTP status when known. */
export function isRetryableByBd(kind: LushaErrorKind, httpStatus?: number): boolean {
  // A 4xx other than 429 is a deterministic request bug: retrying repeats it.
  if (httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 429) return false;
  return RETRYABLE_BY_BD[kind];
}

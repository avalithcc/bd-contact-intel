// Pure parsers over Lusha response bodies. No IO. Anything that does not match
// the expected shape fails closed with a typed LushaError or a typed outcome;
// a best-effort guess is never written to a Contact (D17).

import { LushaError, kindFromContactCode } from "./errors";
import type { CanRevealEntry } from "./pricing";

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown): string | null => (typeof x === "string" && x.trim() !== "" ? x.trim() : null);

export interface LushaIdentity {
  name: string | null;
  company: string | null;
  domain: string | null;
  linkedin: string | null;
}

export type SearchOutcome =
  | {
      outcome: "matched";
      lushaId: string;
      identity: LushaIdentity;
      canReveal: CanRevealEntry[];
      /** billing.creditsCharged: the cap counts credits CHARGED. null when billing is absent or invalid. */
      creditsCharged: number | null;
      lowBalance: boolean | null;
    }
  | { outcome: "no_match"; creditsCharged: number | null; lowBalance: boolean | null };

export interface EnrichOutcome {
  /**
   * RAW value of the result's `emails` key: undefined when the key is absent (a real
   * no-value), the value as received otherwise, even with the wrong type, so pickEmail
   * can fail closed on it instead of it being flattened to [].
   */
  emails: unknown;
  /** Same contract as `emails`. */
  phones: unknown;
  /** Credits Lusha reports as billed; null when the body carries no valid billing. */
  creditsCharged: number | null;
  /** status "partial" (e.g. WATERFALL_NOT_IN_PLAN): a no-value outcome, not an error. */
  partial: boolean;
  /** Top-level status/statusReason (e.g. WATERFALL_NOT_IN_PLAN); informational only. */
  statusReason: string | null;
  /** billing.lowBalance: Lusha itself says the balance is low. */
  lowBalance: boolean | null;
}

const lowBalanceOf = (body: Record<string, unknown>): boolean | null =>
  isRecord(body.billing) && typeof body.billing.lowBalance === "boolean" ? body.billing.lowBalance : null;

const creditsChargedOf = (body: Record<string, unknown>): number | null => {
  const billed = isRecord(body.billing) ? body.billing.creditsCharged : null;
  return typeof billed === "number" && Number.isSafeInteger(billed) && billed >= 0 ? billed : null;
};

function assertNotAsync(body: Record<string, unknown>): void {
  if ("job" in body || "jobId" in body) throw new LushaError("async_unsupported");
}

function throwOnContactError(entry: Record<string, unknown>): void {
  const error = isRecord(entry.error) ? entry.error : null;
  const kind = kindFromContactCode(error ? str(error.code) : null);
  if (kind && kind !== "not_found") throw new LushaError(kind);
}

/**
 * Results are not guaranteed to keep input order: match on the reference, never the index.
 * A duplicated reference fails closed (which one is ours?) instead of first-wins.
 */
export function matchByClientReferenceId(results: unknown, clientReferenceId: string): Record<string, unknown> | null {
  if (!Array.isArray(results)) return null;
  const hits = results.filter((r): r is Record<string, unknown> => isRecord(r) && r.clientReferenceId === clientReferenceId);
  if (hits.length > 1) throw new LushaError("unparsable_value", "duplicate clientReferenceId in results");
  return hits[0] ?? null;
}

/** Real results carry firstName/lastName (enrich also fullName); older shapes a single name. */
function personName(entry: Record<string, unknown>): string | null {
  const full = [str(entry.firstName), str(entry.lastName)].filter(Boolean).join(" ");
  return full || str(entry.fullName) || str(entry.name);
}

export function parseSearchResponse(body: unknown, clientReferenceId: string): SearchOutcome {
  if (!isRecord(body)) throw new LushaError("unparsable_value", "unreadable search response");
  assertNotAsync(body);
  if (!Array.isArray(body.results)) throw new LushaError("unparsable_value", "search response has no results array");
  const lowBalance = lowBalanceOf(body);
  const creditsCharged = creditsChargedOf(body);
  const entry = matchByClientReferenceId(body.results, clientReferenceId);
  if (!entry) return { outcome: "no_match", creditsCharged, lowBalance };
  throwOnContactError(entry);
  const code = isRecord(entry.error) ? str(entry.error.code) : null;
  const lushaId = str(entry.id);
  if (!lushaId) {
    // Only an explicit NOT_FOUND is "Lusha has nothing"; a charged, malformed entry is not.
    if (kindFromContactCode(code) === "not_found") return { outcome: "no_match", creditsCharged, lowBalance };
    throw new LushaError("unparsable_value", "matched search result has no usable id");
  }
  const company = isRecord(entry.company) ? entry.company : {};
  const social = isRecord(entry.socialLinks) ? entry.socialLinks : {};
  const canReveal: CanRevealEntry[] = [];
  if (Array.isArray(entry.canReveal)) {
    for (const c of entry.canReveal) {
      if (isRecord(c) && str(c.field) && typeof c.credits === "number") canReveal.push({ field: str(c.field)!, credits: c.credits });
    }
  }
  return {
    outcome: "matched",
    lushaId,
    identity: { name: personName(entry), company: str(company.name), domain: str(company.domain), linkedin: str(social.linkedin) },
    canReveal,
    creditsCharged,
    lowBalance,
  };
}

export function parseEnrichResponse(body: unknown, lushaId: string): EnrichOutcome {
  if (!isRecord(body)) throw new LushaError("unparsable_value", "unreadable enrich response");
  assertNotAsync(body);
  if (!Array.isArray(body.results)) throw new LushaError("unparsable_value", "enrich response has no results array");
  const partial = body.status === "partial";
  const entry = body.results.find((r) => isRecord(r) && r.id === lushaId);
  if (!isRecord(entry)) {
    // No entry for our id: a real no-value only when Lusha says the data is partial.
    // Otherwise credits may have been charged for something we cannot read.
    if (!partial) throw new LushaError("unparsable_value", "enrich response has no result for the requested id");
  } else {
    throwOnContactError(entry);
  }
  const own = isRecord(entry) ? entry : {};
  return {
    emails: own.emails,
    phones: own.phones,
    creditsCharged: creditsChargedOf(body),
    partial,
    statusReason: str(body.statusReason),
    lowBalance: lowBalanceOf(body),
  };
}

export type Pick =
  | { ok: true; value: string; type: string | null; confidence: number | null; raw: unknown }
  | { ok: false; reason: "empty" | "unparsable_value"; raw: unknown };

interface Candidate {
  value: string;
  type: string | null;
  confidence: number;
  /** On one of the Contact's company domains. Always false for a phone and when no domain is known. */
  onCompanyDomain: boolean;
}

/**
 * Lusha grades confidence as a LETTER ("A+"), not a number, so a numeric-only read scores every real
 * entry -Infinity and the tiebreaker below silently does nothing. The 18 grades (F- .. A+) map onto the
 * 0-100 scale of person.email_confidence, so one number serves both the choice and that column. A number
 * is accepted only when it is already an integer on that scale: a value on an unknown scale must never
 * be written as a percentage (D17), so anything else stays "unknown".
 */
const confidenceOf = (x: unknown): number => {
  // typeof, not Number(): Number(null) is 0 and Number(true) is 1.
  if (typeof x === "number") return Number.isInteger(x) && x >= 0 && x <= 100 ? x : -Infinity;
  const grade = /^([A-F])([+-]?)$/.exec(typeof x === "string" ? x.trim().toUpperCase() : "");
  if (!grade) return -Infinity;
  return Math.round((("FEDCBA".indexOf(grade[1]) * 3 + (grade[2] === "+" ? 3 : grade[2] === "-" ? 1 : 2)) / 18) * 100);
};

/** "www.Alephee.com", "https://alephee.com/" and "alephee.com" are one company. */
export const normalizeDomain = (x: unknown): string | null =>
  str(x)
    ?.toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "") || null;

const hostOf = (email: string): string => email.slice(email.lastIndexOf("@") + 1).toLowerCase();

/** Lexicographic over the criteria below; a tie keeps the candidate already held, i.e. the earlier one. */
const outranks = (c: Candidate, best: Candidate): boolean => {
  const score = (x: Candidate): readonly number[] => [x.onCompanyDomain ? 1 : 0, x.type === "work" ? 1 : 0, x.confidence];
  const [a, b] = [score(c), score(best)];
  const i = a.findIndex((v, n) => v !== b[n]);
  return i >= 0 && a[i] > b[i];
};

/**
 * The company's own domain first, then a work type, then confidence, then input order.
 *
 * WHY the domain outranks the rest: Lusha returns every address it holds for one person, in no
 * meaningful order. The first real reveal returned jonathan@alephcrm.com AND jonathan@alephee.com, both
 * "work" and both "A+", for a Contact whose company is alephee.com — order of arrival decided it and
 * picked the other company's domain. The address at the company we are prospecting is the one that has
 * to reach them, so it wins; `companyDomains` is empty for a phone and the order is unchanged there.
 */
function choose(raw: unknown, valueKey: string, valid: (v: string) => boolean, companyDomains: readonly string[] = []): Pick {
  // An absent key (undefined) is a real no-value, same as []; any other non-array is unparsable.
  if (raw === undefined || (Array.isArray(raw) && raw.length === 0)) return { ok: false, reason: "empty", raw };
  const wanted = new Set(companyDomains.map(normalizeDomain).filter((d): d is string => d !== null));
  const candidates: Candidate[] = [];
  if (Array.isArray(raw)) {
    for (const e of raw) {
      const value = isRecord(e) ? str(e[valueKey]) : null;
      if (!isRecord(e) || !value || !valid(value)) continue;
      candidates.push({ value, type: str(e.type), confidence: confidenceOf(e.confidence), onCompanyDomain: wanted.has(hostOf(value)) });
    }
  }
  if (candidates.length === 0) return { ok: false, reason: "unparsable_value", raw };
  let best = candidates[0];
  for (const c of candidates.slice(1)) if (outranks(c, best)) best = c;
  return { ok: true, value: best.value, type: best.type, confidence: Number.isFinite(best.confidence) ? best.confidence : null, raw };
}

/** `companyDomains`: the Contact's company domain on our side and the one Lusha matched (see choose). */
export const pickEmail = (raw: unknown, companyDomains: readonly string[] = []): Pick =>
  choose(raw, "email", (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), companyDomains);
/** Fails closed: the phone shape was never measured, so an unexpected entry writes nothing. */
export const pickPhone = (raw: unknown): Pick => choose(raw, "number", (v) => /^\+?[\d\s().-]+$/.test(v) && v.replace(/\D/g, "").length >= 7);

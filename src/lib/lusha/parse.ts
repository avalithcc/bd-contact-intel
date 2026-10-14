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
  | { outcome: "matched"; lushaId: string; identity: LushaIdentity; canReveal: CanRevealEntry[]; lowBalance: boolean | null }
  | { outcome: "no_match"; lowBalance: boolean | null };

export interface EnrichOutcome {
  emails: unknown[];
  phones: unknown[];
  /** Credits Lusha reports as billed; null when the body carries no billing. */
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

function assertNotAsync(body: Record<string, unknown>): void {
  if ("job" in body || "jobId" in body) throw new LushaError("async_unsupported");
}

function throwOnContactError(entry: Record<string, unknown>): void {
  const error = isRecord(entry.error) ? entry.error : null;
  const kind = kindFromContactCode(error ? str(error.code) : null);
  if (kind && kind !== "not_found") throw new LushaError(kind);
}

/** Results are not guaranteed to keep input order: match on the reference, never the index. */
export function matchByClientReferenceId(results: unknown, clientReferenceId: string): Record<string, unknown> | null {
  if (!Array.isArray(results)) return null;
  for (const r of results) if (isRecord(r) && r.clientReferenceId === clientReferenceId) return r;
  return null;
}

/** Real results carry firstName/lastName (enrich also fullName); older shapes a single name. */
function personName(entry: Record<string, unknown>): string | null {
  const full = [str(entry.firstName), str(entry.lastName)].filter(Boolean).join(" ");
  return full || str(entry.fullName) || str(entry.name);
}

export function parseSearchResponse(body: unknown, clientReferenceId: string): SearchOutcome {
  if (!isRecord(body)) throw new LushaError("unavailable", "unreadable search response");
  assertNotAsync(body);
  const lowBalance = lowBalanceOf(body);
  const entry = matchByClientReferenceId(body.results, clientReferenceId);
  if (!entry) return { outcome: "no_match", lowBalance };
  throwOnContactError(entry);
  const lushaId = str(entry.id);
  if (!lushaId) return { outcome: "no_match", lowBalance };
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
    lowBalance,
  };
}

export function parseEnrichResponse(body: unknown, lushaId: string): EnrichOutcome {
  if (!isRecord(body)) throw new LushaError("unavailable", "unreadable enrich response");
  assertNotAsync(body);
  const entry = Array.isArray(body.results) ? body.results.find((r) => isRecord(r) && r.id === lushaId) : null;
  if (isRecord(entry)) throwOnContactError(entry);
  const billed = isRecord(body.billing) ? body.billing.creditsCharged : null;
  return {
    emails: isRecord(entry) && Array.isArray(entry.emails) ? entry.emails : [],
    phones: isRecord(entry) && Array.isArray(entry.phones) ? entry.phones : [],
    creditsCharged: typeof billed === "number" && Number.isSafeInteger(billed) && billed >= 0 ? billed : null,
    partial: body.status === "partial",
    statusReason: str(body.statusReason),
    lowBalance: lowBalanceOf(body),
  };
}

export type Pick =
  | { ok: true; value: string; type: string | null; raw: unknown }
  | { ok: false; reason: "empty" | "unparsable_value"; raw: unknown };

interface Candidate {
  value: string;
  type: string | null;
  confidence: number;
}

/** Work type first, then highest confidence, then first in the list. */
function choose(raw: unknown, valueKey: string, valid: (v: string) => boolean): Pick {
  if (Array.isArray(raw) && raw.length === 0) return { ok: false, reason: "empty", raw };
  const candidates: Candidate[] = [];
  if (Array.isArray(raw)) {
    for (const e of raw) {
      const value = isRecord(e) ? str(e[valueKey]) : null;
      if (!isRecord(e) || !value || !valid(value)) continue;
      const confidence = Number(e.confidence);
      candidates.push({ value, type: str(e.type), confidence: Number.isFinite(confidence) ? confidence : -Infinity });
    }
  }
  if (candidates.length === 0) return { ok: false, reason: "unparsable_value", raw };
  let best = candidates[0];
  for (const c of candidates.slice(1)) {
    const cw = c.type === "work" ? 1 : 0;
    const bw = best.type === "work" ? 1 : 0;
    if (cw > bw || (cw === bw && c.confidence > best.confidence)) best = c;
  }
  return { ok: true, value: best.value, type: best.type, raw };
}

export const pickEmail = (raw: unknown): Pick => choose(raw, "email", (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
/** Fails closed: the phone shape was never measured, so an unexpected entry writes nothing. */
export const pickPhone = (raw: unknown): Pick => choose(raw, "number", (v) => /^\+?[\d\s().-]+$/.test(v) && v.replace(/\D/g, "").length >= 7);

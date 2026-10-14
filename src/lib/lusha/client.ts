// The Lusha REST edge. The API key and the fetch implementation are ARGUMENTS:
// this module never reads process.env and never binds a global fetch, so no
// test and no caller can spend a credit by accident. Nothing is retried: a
// retry on a paid endpoint is a second charge. Errors carry a static message,
// never the key, the URL query or the upstream error text.

import { LushaError, kindFromHttpStatus } from "./errors";

const BASE_URL = "https://api.lusha.com";
const TIMEOUT_MS = 15_000;

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;
export type RevealField = "emails" | "phones";

export interface RateLimitWindow {
  limit: number | null;
  left: number | null;
}
export interface RateLimit {
  daily: RateLimitWindow;
  hourly: RateLimitWindow;
  minute: RateLimitWindow;
}
export interface LushaResponse {
  body: unknown;
  rateLimit: RateLimit;
}
export interface SearchInput {
  personId: string;
  firstName: string;
  lastName: string;
  companyDomain: string;
  linkedinUrl: string;
}

const num = (v: string | null): number | null => (v !== null && /^\d+$/.test(v.trim()) ? Number(v) : null);

function readRateLimit(h: Headers): RateLimit {
  const w = (name: "daily" | "hourly" | "minute"): RateLimitWindow => ({
    limit: num(h.get(`x-rate-limit-${name}`)),
    left: num(h.get(`x-${name}-requests-left`)),
  });
  return { daily: w("daily"), hourly: w("hourly"), minute: w("minute") };
}

async function call(apiKey: string, fetchFn: FetchFn, method: "GET" | "POST", path: string, payload?: unknown): Promise<LushaResponse> {
  let res: Response;
  try {
    res = await fetchFn(`${BASE_URL}${path}`, {
      method,
      headers: { api_key: apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Timeout, DNS, reset: the upstream message is dropped on purpose.
    throw new LushaError("unavailable", "Lusha request did not complete");
  }
  const kind = kindFromHttpStatus(res.status);
  if (kind) throw new LushaError(kind, `Lusha request failed with status ${res.status}`, res.status);
  try {
    return { body: await res.json(), rateLimit: readRateLimit(res.headers) };
  } catch {
    throw new LushaError("unavailable", "Lusha response was not readable", res.status);
  }
}

/** One search = 1 credit for up to 25 contacts; we send one. */
export function searchContact(apiKey: string, fetchFn: FetchFn, input: SearchInput): Promise<LushaResponse> {
  const { personId, ...rest } = input;
  return call(apiKey, fetchFn, "POST", "/v3/contacts/search", { contacts: [{ clientReferenceId: personId, ...rest }] });
}

/**
 * `reveal` is REQUIRED and always sent: omitting it makes Lusha return both
 * fields and spend 5 extra credits.
 */
export function enrichContact(apiKey: string, fetchFn: FetchFn, ids: string[], reveal: RevealField): Promise<LushaResponse> {
  if (reveal !== "emails" && reveal !== "phones") return Promise.reject(new LushaError("unavailable", "reveal field is required"));
  return call(apiKey, fetchFn, "POST", "/v3/contacts/enrich", { ids, reveal: [reveal] });
}

/** Free and eventually consistent: display only, never enforcement. Never throws. */
export async function getAccountUsage(apiKey: string, fetchFn: FetchFn): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: (await call(apiKey, fetchFn, "GET", "/v3/account/usage")).body };
  } catch {
    return { ok: false };
  }
}

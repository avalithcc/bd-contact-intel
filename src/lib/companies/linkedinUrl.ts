/**
 * `company.linkedin_url` — the LinkedIn page of a company (or school), typed
 * or pasted by a BD. Pure normaliser + validator; no I/O.
 *
 * ONE stored form: `linkedin.com/company/<slug>` or
 * `linkedin.com/school/<slug>` — lowercase, no protocol, no `www`, no query,
 * no fragment, no trailing slash. This is deliberately the same shape
 * `normalizeProfileKey` (src/lib/csv.ts) produces for people, so the codebase
 * has one way of writing a LinkedIn URL.
 *
 * Where it diverges from `normalizeProfileKey`, on purpose:
 *  - it validates (that function accepts any host and any path);
 *  - every `*.linkedin.com` host (ar., es., m., www.) collapses onto
 *    `linkedin.com`, because pasted company links often carry a country
 *    subdomain and the same company must not be stored twice;
 *  - only the first two path segments are kept, so `/company/x/about/`
 *    stores as `/company/x`;
 *  - a bare slug is accepted (`avalith` -> `linkedin.com/company/avalith`).
 *
 * A personal profile (`/in/...`) is rejected, not stored: the field is
 * trusted only if it can only hold company pages.
 */

import type { Dictionary } from "@/lib/i18n/dictionaries";

export type LinkedinUrlRejection = "not_linkedin" | "personal_profile" | "invalid_path" | "unparseable";

export type LinkedinUrlResult =
  | { ok: true; value: string | null }
  | { ok: false; reason: LinkedinUrlRejection };

const BARE_SLUG = /^[\p{L}\p{N}_%-]+$/u;
/** The ONE definition of "this text is URL-shaped, not a bare word": a dot,
 * slash or colon. Shared by the normaliser and the search routing. */
const URL_SHAPED = /[./:]/;
const SCHEME = /^([a-z][a-z0-9+.-]*):(?!\d)/i;
const STORED_FORM = /^linkedin\.com\/(company|school)\/[^\s/]+$/;

function reject(reason: LinkedinUrlRejection): LinkedinUrlResult {
  return { ok: false, reason };
}

/** Blank or whitespace-only input clears the field (`value: null`). */
export function normalizeCompanyLinkedinUrl(raw: string): LinkedinUrlResult {
  const text = (raw ?? "").trim();
  if (!text) return { ok: true, value: null };
  if (/\s/.test(text)) return reject("unparseable");

  let candidate = text;
  const scheme = SCHEME.exec(text)?.[1]?.toLowerCase();
  if (scheme && scheme !== "http" && scheme !== "https") return reject("not_linkedin");
  if (!scheme) {
    if (/^(company|school|in)\//i.test(text)) {
      candidate = `linkedin.com/${text}`;
    } else if (!URL_SHAPED.test(text)) {
      if (!BARE_SLUG.test(text)) return reject("unparseable");
      candidate = `linkedin.com/company/${text}`;
    }
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
  } catch {
    return reject("unparseable");
  }

  const host = url.hostname.toLowerCase();
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return reject("not_linkedin");

  const [kind, slug] = url.pathname.toLowerCase().split("/").filter(Boolean);
  if (kind === "in") return reject("personal_profile");
  if ((kind !== "company" && kind !== "school") || !slug) return reject("invalid_path");
  return { ok: true, value: `linkedin.com/${kind}/${slug}` };
}

export type LinkedinSearchTerm =
  | { kind: "exact"; value: string; slug: string }
  | { kind: "slug"; slug: string }
  | null;

/**
 * How one whitespace-free search token relates to the stored LinkedIn form.
 * Goes through `normalizeCompanyLinkedinUrl`, so a pasted URL becomes exactly
 * the value the column holds.
 *  - `exact`: the token is URL-shaped and normalises to a company/school page
 *    -> equality against the column; `slug` is carried too so the caller can
 *    still match by name while the column is empty.
 *  - `slug`: a bare word -> substring of the slug, alongside the normal
 *    name/domain search.
 *  - `null`: not a LinkedIn term (other host, `/in/` profile, junk, blank) ->
 *    the caller keeps the existing search for that token.
 */
export function companyLinkedinSearchTerm(token: string): LinkedinSearchTerm {
  const result = normalizeCompanyLinkedinUrl(token);
  if (!result.ok || !result.value) return null;
  const slug = result.value.split("/")[2];
  return URL_SHAPED.test(token) ? { kind: "exact", value: result.value, slug } : { kind: "slug", slug };
}

/** Thrown by planCompanyPropertyEdit before building any plan. */
export class InvalidCompanyLinkedinUrlError extends Error {
  constructor(
    public readonly reason: LinkedinUrlRejection,
    public readonly value: string,
  ) {
    super(`Invalid company LinkedIn URL (${reason}): ${value}`);
    this.name = "InvalidCompanyLinkedinUrlError";
  }
}

/** The clickable `https://` link for a stored value, or null when the value
 * is not in the stored form (never builds a link from arbitrary text). */
export function companyLinkedinUrlHref(stored: string | null): string | null {
  return stored && STORED_FORM.test(stored) ? `https://${stored}` : null;
}

export type LinkedinUrlErrorLabels = Pick<
  Dictionary["companyRecord"],
  | "linkedinErrorNotLinkedin"
  | "linkedinErrorPersonalProfile"
  | "linkedinErrorInvalidPath"
  | "linkedinErrorUnparseable"
>;

/** The user-facing message for a rejection reason. */
export function linkedinUrlErrorMessage(reason: LinkedinUrlRejection, l: LinkedinUrlErrorLabels): string {
  switch (reason) {
    case "not_linkedin":
      return l.linkedinErrorNotLinkedin;
    case "personal_profile":
      return l.linkedinErrorPersonalProfile;
    case "invalid_path":
      return l.linkedinErrorInvalidPath;
    case "unparseable":
      return l.linkedinErrorUnparseable;
  }
}

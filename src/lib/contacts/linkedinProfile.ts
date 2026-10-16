/**
 * Builds the LinkedIn badge's href from `person.profileKey` (mockup-port
 * r02; contact-record.html:64's outline "LinkedIn" badge). `profileKey` is
 * normalized as `hostname + path`, no protocol (src/lib/csv.ts
 * #normalizeProfileKey) — this just re-adds `https://`. Pure, no I/O.
 */
import { normalizeProfileKey } from "@/lib/csv";

export type LinkedinProfileKeyRejection = "not_linkedin" | "not_a_profile" | "unparseable";

/** First path segments of a personal profile URL (`/in/<slug>`, legacy `/pub/...`). */
const PROFILE_SEGMENTS = new Set(["in", "pub"]);

export type LinkedinProfileKeyResult =
  | { ok: true; value: string }
  | { ok: false; reason: LinkedinProfileKeyRejection };

/**
 * Validates a typed or pasted person LinkedIn URL. The stored value is EXACTLY
 * what `normalizeProfileKey` (csv.ts, the importers' producer) returns, so a
 * hand edit and a later import write the same shape for the same profile
 * (country subdomains are kept, as the importers keep them). This only adds
 * validation on top: the host must be linkedin.com (or a subdomain) and the
 * path must be a personal profile, because `profile_key` is the identity
 * matcher's strongest key and a company page there could auto-merge people.
 * Blank input is the caller's concern (it means "clear"), not handled here.
 */
export function normalizeLinkedinProfileKey(raw: string): LinkedinProfileKeyResult {
  const key = normalizeProfileKey(raw);
  if (!key) return { ok: false, reason: "unparseable" };
  const [host = "", firstSegment = ""] = key.split("/");
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return { ok: false, reason: "not_linkedin" };
  if (!PROFILE_SEGMENTS.has(firstSegment)) return { ok: false, reason: "not_a_profile" };
  return { ok: true, value: key };
}

export function linkedinProfileHref(profileKey: string | null): string | null {
  if (!profileKey) return null;
  return `https://${profileKey}`;
}

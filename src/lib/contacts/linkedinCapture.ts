/**
 * Decisions of the `/capture/linkedin?url=…` route (linkedin-exists-check
 * mockup). Old bookmarklet favorites send ONLY the page URL, so everything is decided
 * from that string: validate it as a personal profile, normalize it to the
 * same `profile_key` the importers write, and pick where to send the BD.
 * Pure, no I/O.
 */
import { normalizeLinkedinProfileKey, linkedinProfileHref } from "@/lib/contacts/linkedinProfile";

/** Why a received URL is not a personal profile; one message per reason in the UI. */
export type CaptureRejection = "missing" | "not_linkedin" | "company" | "general";

export type CaptureParse =
  | { ok: true; profileKey: string; linkedinUrl: string }
  | { ok: false; reason: CaptureRejection; received: string | null };

const RECEIVED_MAX = 120;

function parseUrl(raw: string): URL | null {
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

function isLinkedinHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "linkedin.com" || host.endsWith(".linkedin.com");
}

/** Host + path only (no query or fragment, which can carry tokens), bounded for display. */
function receivedText(url: URL): string {
  return `${url.hostname.toLowerCase().replace(/^www\./, "")}${url.pathname}`.slice(0, RECEIVED_MAX);
}

export function parseCaptureUrl(raw: string | null | undefined): CaptureParse {
  const text = raw?.trim() ?? "";
  if (!text) return { ok: false, reason: "missing", received: null };

  const key = normalizeLinkedinProfileKey(text);
  if (key.ok) return { ok: true, profileKey: key.value, linkedinUrl: linkedinProfileHref(key.value)! };

  const url = parseUrl(text);
  if (!url || !url.hostname.includes(".") || !isLinkedinHost(url.hostname)) {
    return { ok: false, reason: "not_linkedin", received: url ? receivedText(url) : text.slice(0, RECEIVED_MAX) };
  }
  const firstSegment = url.pathname.split("/")[1]?.toLowerCase();
  return { ok: false, reason: firstSegment === "company" ? "company" : "general", received: receivedText(url) };
}

/**
 * A live person goes to the record (the `from` flag shows the "Ya está en el
 * CRM" notice); nobody found opens "Nuevo contacto" with the link loaded.
 */
export function captureRedirectPath(found: { linkedinUrl: string }, livePersonId: string | null): string {
  if (livePersonId) return `/contacts/${livePersonId}?from=linkedin`;
  return `/contacts?new=1&linkedin=${encodeURIComponent(found.linkedinUrl)}`;
}

export type NoticeOwner = "mine" | "other" | "none";

/**
 * Which "Ya está en el CRM" variant to show. Only used on the record page,
 * which already names the owner to every viewer, so this reveals nothing new.
 */
export function noticeOwnerVariant(ownerBdId: string | null, ownerName: string | null, meId: string): NoticeOwner {
  if (!ownerBdId || !ownerName) return "none";
  return ownerBdId === meId ? "mine" : "other";
}

/** The only `?from=` value the record page reacts to. */
export function isFromLinkedin(value: string | undefined): boolean {
  return value === "linkedin";
}

/** Pre-fill for `/contacts?linkedin=`: re-validated, never trusted from the query string. */
export function linkedinPrefill(value: string | undefined): string | undefined {
  const parsed = parseCaptureUrl(value);
  return parsed.ok ? parsed.linkedinUrl : undefined;
}

/** Login hint: true when the (already sanitized) `next` is the capture route. */
export function isCaptureNextPath(next: string): boolean {
  return next === "/capture/linkedin" || next.startsWith("/capture/linkedin?");
}

/** `pathname` + `search` minus the given params, so a refresh does not replay a one-shot link. */
export function withoutQueryParams(pathname: string, search: string, keys: readonly string[]): string {
  const params = new URLSearchParams(search);
  for (const key of keys) params.delete(key);
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}

/**
 * Which LinkedIn pages are a personal profile. The card appears ONLY on the profile root
 * (`/in/<slug>/`), never on its sub-pages, the feed, searches, messages or company pages.
 * Pure, no DOM and no chrome.* so it runs in the content script, the worker and the tests.
 */
const LINKEDIN_HOSTS = new Set(["www.linkedin.com", "linkedin.com"]);
const SLUG = /^[^/\s?#]{1,200}$/;

function canonical(slug: string): string {
  return `https://www.linkedin.com/in/${slug}/`;
}

/** `https://www.linkedin.com/in/<slug>/` for a profile root page, else null. */
export function profileUrlFromLocation(location: { hostname: string; pathname: string }): string | null {
  if (!LINKEDIN_HOSTS.has(location.hostname.toLowerCase())) return null;
  const match = /^\/in\/([^/]+)\/?$/.exec(location.pathname);
  return match && SLUG.test(match[1]!) ? canonical(match[1]!) : null;
}

/**
 * Re-parses a URL received in a message. Only https on the LinkedIn hosts qualifies; query and fragment
 * (which can carry tracking tokens) are dropped, so what leaves for the CRM is always the canonical form.
 */
export function parseProfileUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    return profileUrlFromLocation(url);
  } catch {
    return null;
  }
}

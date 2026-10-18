/**
 * EVERY piece of knowledge about LinkedIn's page structure lives in this file, and nowhere else. LinkedIn changes
 * its markup without notice, so each field has an ordered list of fallbacks; when none matches, the field is read
 * as empty and the BD fills it in. These selectors are best effort and must be re-checked against a real profile
 * (extension/README.md, "When LinkedIn changes its page").
 *
 * Everything is resolved inside the top-card section of the profile that is open (the section that holds the
 * profile's own `h1`), never from the whole page, so nothing from the feed, a sidebar or another profile is read.
 */
export const SELECTORS = {
  /** The profile name. The first one with text wins. */
  name: ["main h1", "h1"],
  /** The section around the name: the "top card". Falls back to <main>. */
  topCardRoot: "section",
  /** The headline under the name, used as the job title. Resolved inside the top card. */
  headline: [".text-body-medium.break-words", "[data-generated-suggestion-target]", "div.text-body-medium"],
  /** The location line. Resolved inside the top card. */
  location: [
    "span.text-body-small.inline.t-black--light.break-words",
    ".text-body-small.inline.t-black--light",
    "span.text-body-small",
  ],
  /** Top-card controls whose accessible label names the current company ("Empresa actual: X. …"). */
  companyLabelled: ["button[aria-label]", "a[aria-label]", "[role=button][aria-label]"],
  /** Last resort for the company: the first company link inside the top card. */
  companyLink: 'a[href*="/company/"]',
} as const;

/** Lines that sit where the location does but are not one (contact-info link, follower counts). */
export const NOT_A_LOCATION =
  /contact info|información de contacto|informação de contato|seguidores|followers|conexion|connection|conex/i;

/** `document.title` is "(3) Name | LinkedIn": used for the name only when the page has no `h1`. */
export const TITLE_NAME = /^(?:\(\d+\)\s*)?(.+?)(?:\s+[-–|]\s+.*)?\s*\|\s*LinkedIn\s*$/;

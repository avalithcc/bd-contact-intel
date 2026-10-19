/**
 * EVERY piece of knowledge about LinkedIn's page structure lives in this file, and nowhere else. LinkedIn changes
 * its markup without notice, so each field has an ordered list of fallbacks; when none matches, the field is read
 * as empty and the BD fills it in. These selectors are best effort and must be re-checked against a real profile
 * (extension/README.md, "When LinkedIn changes its page").
 *
 * Everything is resolved inside the top card of the profile that is open, never from <main> or the whole page, so
 * nothing from the feed, the right-column ads ("Al margen") or another profile is read. If no top card is found,
 * only the name is read (from `document.title`).
 */
export const SELECTORS = {
  /** New layout: the top card carries a hashed `componentkey` that ends in "Topcard". */
  topCardByKey: '[componentkey$="Topcard"]',
  /** New layout fallback: the contact-info link sits inside the top card. */
  contactInfoLink: 'a[href*="/overlay/contact-info/"]',
  /** Old layout fallback: the section around the profile's own h1. */
  topCardRoot: "section",
  /** A heading that marks a top card candidate. */
  heading: "h1, h2",
  /** The profile name inside the top card (old layout h1, new layout h2). The first one with text wins. */
  name: ["h1", "h2"],
  /** Old-layout headline under the name. New layout: the first paragraph after the name (profileReader). */
  headline: [".text-body-medium.break-words", "[data-generated-suggestion-target]", "div.text-body-medium"],
  /** Old-layout location line. New layout: the paragraph before the contact-info link (profileReader). */
  location: [
    "span.text-body-small.inline.t-black--light.break-words",
    ".text-body-small.inline.t-black--light",
    "span.text-body-small",
  ],
  /** Top-card controls whose accessible label names the current company ("Empresa actual: X. …"). */
  companyLabelled: ["button[aria-label]", "a[aria-label]", "[role=button][aria-label]"],
  /** New layout: the company/school pair are `role=button` items holding a figure and a text. */
  pairButton: '[role="button"]',
} as const;

/** New layout: the connection-degree line next to the name ("· 1er", "• 2º", "· 1st", "3rd+"). */
export const NOT_A_HEADLINE = /^(?:[·•]\s*)?(?:(?:1st|2nd|3rd)\+?|[123]\s*(?:º|°|er|ro|do|ero)?\+?)$/i;

/** A prefix a control may put before the company name ("Ver empresa: X", "Current company: X"). */
export const COMPANY_PREFIX = /^(?:Ver empresa|View company|Empresa actual|Current company|Empresa atual)\s*[:：]\s*/i;

/** Lines that sit where the location does but are not one (contact-info link, follower counts). */
export const NOT_A_LOCATION =
  /contact info|información de contacto|informação de contato|seguidores|followers|conexion|connection|conex/i;

/** `document.title` is "(3) Name | LinkedIn": used for the name only when the top card has no heading. */
export const TITLE_NAME = /^(?:\(\d+\)\s*)?(.+?)(?:\s+[-–|]\s+.*)?\s*\|\s*LinkedIn\s*$/;

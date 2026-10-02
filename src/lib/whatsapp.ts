import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { isValidPhoneFormat, type WhatsappLink } from "@/lib/phone";

/**
 * The `https://wa.me/<digits>` link for a stored number, or the reason none
 * can be built. One rule, one place: the UI picks its copy from `reason`
 * instead of restating the condition.
 *
 * libphonenumber-js owns what a number IS: trunk prefixes (dropped where the
 * country drops them, kept in Italy) and the Argentine mobile "15" -> "9"
 * conversion come from its per-country metadata, not from rules in this
 * file, and the link is built from the parsed E.164 digits. Lengths are
 * checked with `isPossible` only, so a glued extension or a doubled country
 * code is refused when it makes the number too long, not because it is
 * recognised; a short number with one can still link (pinned in the tests).
 *
 * `invalid`: blank or failing `isValidPhoneFormat` (the `toTelHref` gate).
 * `no_country_code`: a well-formed number with neither `+` nor `00`. NO
 * default country is passed to the parser: stored numbers come from Spain,
 * Italy, Mexico, the Emirates and Argentina, and guessing one would produce
 * confident wrong links.
 * `unsupported`: carries a country code but cannot be a number of that
 * country (wrong length, or a doubled/garbled country code).
 *
 * Runs on the server only (the library's metadata is ~80 kB): client
 * components receive the result as a prop and re-check the URL with
 * `safeWhatsappHref` before rendering it.
 *
 * The result says nothing about whether the number is registered on
 * WhatsApp; the CRM cannot know that.
 */
export function whatsappLink(raw: string | null | undefined): WhatsappLink {
  if (raw == null) return { url: null, reason: "invalid" };
  const trimmed = raw.trim();
  if (!isValidPhoneFormat(trimmed)) return { url: null, reason: "invalid" };
  // "00" is the international exit code almost everywhere; the library only
  // reads "+". `isPossible` below checks length only, so it does NOT catch a
  // wrong guess: "0011 ..." is Australia's exit code, not "00" + "11...".
  const international = trimmed.startsWith("+") ? trimmed : trimmed.replace(/^00\s*/, "+");
  if (!international.startsWith("+")) return { url: null, reason: "no_country_code" };
  // Calling code 1 is the only one starting with 1, so "0010"/"0011" can
  // never be "00" + a real calling code. Refuse them rather than let the
  // parser read "1" as the code and a stranger's number out of the rest.
  if (!trimmed.startsWith("+") && /^1[01]/.test(international.replace(/\D/g, ""))) {
    return { url: null, reason: "unsupported" };
  }
  const parsed = parsePhoneNumberFromString(international);
  // isPossible (country-specific length), NOT isValid (assigned ranges):
  // wa.me validates nothing, and isValid refuses real numbers whose prefix is
  // newer than the bundled metadata. The fixes (trunk 0, extension, E.164)
  // all happen in the parse above, before any predicate runs.
  if (!parsed || !parsed.isPossible()) return { url: null, reason: "unsupported" };
  return { url: `https://wa.me/${parsed.number.slice(1)}` };
}

/** The `wa.me` URL, or `null` for every reason `whatsappLink` can give. */
export function whatsappLinkFor(raw: string | null | undefined): string | null {
  return whatsappLink(raw).url;
}

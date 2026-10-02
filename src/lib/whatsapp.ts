import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { isValidPhoneFormat, type WhatsappLink } from "@/lib/phone";

/**
 * The `https://wa.me/<digits>` link for a stored number, or the reason none
 * can be built. One rule, one place: the UI picks its copy from `reason`
 * instead of restating the condition.
 *
 * libphonenumber-js owns what a number IS: trunk prefixes (dropped where the
 * country drops them, kept in Italy), the Argentine mobile "15" -> "9"
 * conversion, length limits, extensions and a doubled country code all come
 * from its per-country metadata, not from rules in this file. The link is
 * built from the parsed E.164 digits.
 *
 * `invalid`: blank or failing `isValidPhoneFormat` (the `toTelHref` gate).
 * `no_country_code`: a well-formed number with neither `+` nor `00`. NO
 * default country is passed to the parser: stored numbers come from Spain,
 * Italy, Mexico, the Emirates and Argentina, and guessing one would produce
 * confident wrong links.
 * `unsupported`: carries a country code but is not a valid number for it.
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
  // reads "+". A wrong guess here is caught by the validity check below.
  const international = trimmed.startsWith("+") ? trimmed : trimmed.replace(/^00\s*/, "+");
  if (!international.startsWith("+")) return { url: null, reason: "no_country_code" };
  const parsed = parsePhoneNumberFromString(international);
  if (!parsed || !parsed.isValid()) return { url: null, reason: "unsupported" };
  return { url: `https://wa.me/${parsed.number.slice(1)}` };
}

/** The `wa.me` URL, or `null` for every reason `whatsappLink` can give. */
export function whatsappLinkFor(raw: string | null | undefined): string | null {
  return whatsappLink(raw).url;
}

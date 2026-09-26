/**
 * Builds the LinkedIn badge's href from `person.profileKey` (mockup-port
 * r02; contact-record.html:64's outline "LinkedIn" badge). `profileKey` is
 * normalized as `hostname + path`, no protocol (src/lib/csv.ts
 * #normalizeProfileKey) — this just re-adds `https://`. Pure, no I/O.
 */
export function linkedinProfileHref(profileKey: string | null): string | null {
  if (!profileKey) return null;
  return `https://${profileKey}`;
}

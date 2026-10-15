// Side-by-side identity comparison for the Lusha confirmation dialog. A plain normalised string compare
// (lowercase, no diacritics, no protocol / www. / trailing slash): a diff, never a confidence score. Accents
// are folded away on purpose, so a marker that fires on noise cannot teach BDs to ignore it.

export interface IdentityFields {
  name: string | null;
  company: string | null;
  domain: string | null;
  linkedin: string | null;
}

export type IdentityKey = keyof IdentityFields;
export const IDENTITY_KEYS: readonly IdentityKey[] = ["name", "company", "domain", "linkedin"];

const fold = (s: string | null) => (s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const address = (s: string | null) => fold(s).replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");

export function diffIdentity(crm: IdentityFields, lusha: IdentityFields) {
  return IDENTITY_KEYS.map((key) => {
    const norm = key === "domain" || key === "linkedin" ? address : fold;
    return { key, crm: crm[key], lusha: lusha[key], same: norm(crm[key]) === norm(lusha[key]) };
  });
}

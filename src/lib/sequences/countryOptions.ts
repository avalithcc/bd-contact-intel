/**
 * The options of the country picker on a sequence member card.
 *
 * Built FROM `RECOGNIZED_COUNTRIES`, the same table `resolveCountry` matches against, so a BD can never pick a value
 * the audience resolver will not understand. That is the whole point: an unrecognised country does not fall back to
 * anything, it HOLDS the contact, and a draft is never written.
 *
 * Measured in production on 2026-11-17 before this existed: 45 distinct spellings across 4,664 contacts, and all 45
 * resolved. The free-text field had not caused a problem — because those values came from imports, not from typing.
 * The inline edit shipped in #453 is the first place a BD can hand-type one, so the risk starts there, and this
 * removes it rather than waiting for the first "Chle".
 *
 * `label` is also the stored VALUE, in English, because that is what the 4,664 existing rows already hold ("Mexico",
 * "United States", "Spain"). Labelling in Spanish while storing English would show a BD "México" and then render
 * "Mexico" on the card a second later; two spellings per country is a worse trade than English labels in a Spanish UI,
 * which is in any case what the card already displays today.
 */
import { RECOGNIZED_COUNTRIES, resolveCountry } from "@/lib/sequences/countryNames";

export interface CountryOption {
  /** ISO 3166-1 alpha-2, for the React key and for tests. */
  iso: string;
  /** Shown in the select AND written to `person.country`. Guaranteed to resolve back to `iso`. */
  label: string;
}

function build(): CountryOption[] {
  // `RECOGNIZED_COUNTRIES[].names` are normalized match keys (lowercased, punctuation stripped), not display text, so
  // the label has to come from ICU again.
  let display: Intl.DisplayNames;
  try {
    display = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
  } catch {
    return [];
  }

  const options: CountryOption[] = [];
  for (const { iso } of RECOGNIZED_COUNTRIES) {
    const label = display.of(iso);
    if (!label || label.toUpperCase() === iso) continue;
    // The guard that makes this list trustworthy: keep an option ONLY if its own label resolves back to its own ISO.
    // A name ICU gives that is ambiguous between two regions is dropped by `RECOGNIZED_COUNTRIES` and would resolve to
    // null here, so it never becomes an option that silently holds the contact it is picked for.
    if (resolveCountry(label) !== iso) continue;
    options.push({ iso, label });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label, "en"));
}

export const COUNTRY_OPTIONS: readonly CountryOption[] = build();

/**
 * The list to render for a member, with `current` guaranteed to be selectable.
 *
 * A stored value outside the list (an older import, or a spelling ICU stopped recognising after a runtime upgrade) is
 * kept as its own first option instead of being silently replaced by the first country in the alphabet.
 */
export function countryOptionsFor(current: string | null | undefined): readonly CountryOption[] {
  const value = current?.trim();
  if (!value) return COUNTRY_OPTIONS;
  if (COUNTRY_OPTIONS.some((o) => o.label === value)) return COUNTRY_OPTIONS;
  return [{ iso: resolveCountry(value) ?? "??", label: value }, ...COUNTRY_OPTIONS];
}

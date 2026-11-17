/**
 * The invariant that makes a country dropdown worth having: every option a BD can pick must resolve back to a real
 * country. An option that does not is worse than free text — it looks safe and silently HOLDS the contact, because
 * `resolveCountry` returning null means no language, no address and no draft.
 *
 * The "in use" list is not invented: it is every country with more than 20 contacts in production on 2026-11-17.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { COUNTRY_OPTIONS, countryOptionsFor } from "@/lib/sequences/countryOptions";
import { resolveCountry } from "@/lib/sequences/complianceAudience";

describe("COUNTRY_OPTIONS", () => {
  it("offers a usable list at all", () => {
    assert.ok(COUNTRY_OPTIONS.length > 150, `only ${COUNTRY_OPTIONS.length} options`);
  });

  it("every option resolves back to its own ISO — the whole reason this list is derived, not typed", () => {
    const broken = COUNTRY_OPTIONS.filter((o) => resolveCountry(o.label) !== o.iso);
    assert.deepEqual(broken, [], `options that would hold the contact: ${JSON.stringify(broken)}`);
  });

  it("has no duplicate label, so two options cannot store different text for one country", () => {
    const labels = COUNTRY_OPTIONS.map((o) => o.label);
    assert.equal(new Set(labels).size, labels.length);
  });

  it("is sorted, so a BD can find a country without reading the whole list", () => {
    const sorted = [...COUNTRY_OPTIONS].sort((a, b) => a.label.localeCompare(b.label, "en"));
    assert.deepEqual(COUNTRY_OPTIONS.map((o) => o.iso), sorted.map((o) => o.iso));
  });

  it("contains every country the contact base actually uses, by the spelling already stored", () => {
    // AR 2861, MX 428, US 340, CO 316, UY 169, CL 97, EC 94, ES 90, CR 78, IT 53, BR 26, PE 24.
    const inUse = ["Argentina", "Mexico", "United States", "Colombia", "Uruguay", "Chile", "Ecuador", "Spain", "Costa Rica", "Italy", "Brazil", "Peru"];
    for (const name of inUse) {
      assert.ok(COUNTRY_OPTIONS.some((o) => o.label === name), `${name} is stored on real contacts but is not pickable`);
    }
  });
});

describe("countryOptionsFor", () => {
  it("returns the plain list when there is no current value", () => {
    assert.equal(countryOptionsFor(null), COUNTRY_OPTIONS);
    assert.equal(countryOptionsFor("   "), COUNTRY_OPTIONS);
  });

  it("returns the plain list when the current value is already an option", () => {
    assert.equal(countryOptionsFor("Argentina"), COUNTRY_OPTIONS);
  });

  it("keeps an off-list stored value as its own option instead of silently replacing it", () => {
    const list = countryOptionsFor("Republica Inventada");
    assert.equal(list[0]!.label, "Republica Inventada");
    assert.equal(list.length, COUNTRY_OPTIONS.length + 1);
  });

  it("keeps an off-list value that still resolves, carrying its real ISO", () => {
    // "EE. UU." resolves through ALIASES but is not the ICU display name, so it is not in the generated list.
    const list = countryOptionsFor("EE. UU.");
    if (resolveCountry("EE. UU.") === "US") {
      assert.equal(list[0]!.iso, "US", "an alias must keep its country, not degrade to unknown");
    }
  });
});

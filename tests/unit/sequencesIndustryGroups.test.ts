import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { INDUSTRY_GROUPS, INDUSTRY_GROUP_KEYS, KNOWN_INDUSTRY_VALUES, industryGroupOf, industryValuesOf } from "@/lib/sequences/industryGroups";
import { es } from "@/lib/i18n/dictionaries/es";
import { en } from "@/lib/i18n/dictionaries/en";

// Derived from the module itself: nothing here restates a value, so adding one to the data cannot make a test lie.
const all = INDUSTRY_GROUP_KEYS.flatMap((k) => INDUSTRY_GROUPS[k].map((v) => [k, v] as const));

test("every raw value belongs to exactly one group, and the failure names the culprit", () => {
  const seen = new Map<string, string[]>();
  for (const [k, v] of all) seen.set(v, [...(seen.get(v) ?? []), k]);
  const twice = [...seen].filter(([, groups]) => groups.length > 1).map(([v, groups]) => `${JSON.stringify(v)} in ${groups.join(" + ")}`);
  assert.deepEqual(twice, [], `values in two groups: ${twice.join("; ")}`);
  assert.equal(KNOWN_INDUSTRY_VALUES.size, all.length, "the lookup set holds one entry per listed value");
});

test("no group is empty and every group key is declared once", () => {
  assert.equal(new Set(INDUSTRY_GROUP_KEYS).size, INDUSTRY_GROUP_KEYS.length);
  for (const k of INDUSTRY_GROUP_KEYS) assert.ok(INDUSTRY_GROUPS[k].length > 0, `${k} is empty`);
  assert.deepEqual(Object.keys(INDUSTRY_GROUPS).sort(), [...INDUSTRY_GROUP_KEYS].sort(), "keys and data cannot drift apart");
});

test("group -> values and value -> group are inverse", () => {
  for (const [k, v] of all) {
    assert.equal(industryGroupOf(v), k);
    assert.ok(industryValuesOf(k).includes(v));
  }
  assert.equal(industryGroupOf("not an industry"), null);
  assert.equal(industryGroupOf("software de ordenador"), null, "exact match: no case folding");
});

test("values are stored exactly: the double space stays, and none needs trimming (SQL compares the trimmed column)", () => {
  assert.ok(KNOWN_INDUSTRY_VALUES.has("Tecnología y servicios  de la Información"));
  assert.ok(!KNOWN_INDUSTRY_VALUES.has("Tecnología y servicios de la Información"));
  for (const [, v] of all) assert.equal(v, v.trim());
});

test("the mapping covers the 91 verified raw values", () => {
  assert.equal(KNOWN_INDUSTRY_VALUES.size, 91);
});

test("every group has a Spanish and an English label", () => {
  for (const k of INDUSTRY_GROUP_KEYS) {
    assert.ok(es.sequences.pickIndustryGroups[k], `es ${k}`);
    assert.ok(en.sequences.pickIndustryGroups[k], `en ${k}`);
  }
});

test("the mapping equals the owner-verified file value for value: a rename or a swap between groups fails here", () => {
  // The file is the mapping verified against production (sum = measured total, 0 orphans, 0 duplicates). Reading it from
  // openspec/ means archiving that change must move this pin with it; a silent rename would drop contacts from every chip.
  const verified = JSON.parse(readFileSync(join(process.cwd(), "openspec/changes/sequence-industry-filter/grupos-verificados.json"), "utf8"));
  assert.deepEqual(INDUSTRY_GROUPS, verified);
  assert.deepEqual([...INDUSTRY_GROUP_KEYS], Object.keys(verified), "chip order is the verified order too");
});

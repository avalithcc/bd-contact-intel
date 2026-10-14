import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SEARCH_COST, expectedCost, type CanRevealEntry } from "../../src/lib/lusha/pricing";

const probe: CanRevealEntry[] = [
  { field: "emails", credits: 1 },
  { field: "phones", credits: 5 },
];

test("the search costs its declared single credit", () => {
  assert.equal(SEARCH_COST, 1);
  assert.deepEqual(expectedCost("search", null), { ok: true, credits: 1 });
});

test("a reveal is priced from the API's own canReveal list", () => {
  assert.deepEqual(expectedCost("emails", probe), { ok: true, credits: 1 });
  assert.deepEqual(expectedCost("phones", probe), { ok: true, credits: 5 });
});

test("the price follows the list, not a table", () => {
  assert.deepEqual(expectedCost("emails", [{ field: "emails", credits: 3 }]), { ok: true, credits: 3 });
});

test("credits 0 means already revealed for the account and is passed through", () => {
  assert.deepEqual(expectedCost("emails", [{ field: "emails", credits: 0 }]), { ok: true, credits: 0 });
});

test("a reveal with no cached canReveal is refused, never guessed", () => {
  assert.deepEqual(expectedCost("emails", null), { ok: false, reason: "no_price_list" });
  assert.deepEqual(expectedCost("phones", undefined), { ok: false, reason: "no_price_list" });
});

test("a field absent from canReveal is not revealable", () => {
  assert.deepEqual(expectedCost("emails", [{ field: "phones", credits: 5 }]), {
    ok: false,
    reason: "not_revealable",
  });
  assert.deepEqual(expectedCost("emails", []), { ok: false, reason: "not_revealable" });
});

test("a malformed price is refused, not coerced", () => {
  for (const credits of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, "5" as unknown as number]) {
    assert.deepEqual(expectedCost("phones", [{ field: "phones", credits }]), {
      ok: false,
      reason: "not_revealable",
    });
  }
});

test("pricing.ts hardcodes no price: the only price literal is the search's 1", () => {
  const src = readFileSync(join(__dirname, "..", "..", "src", "lib", "lusha", "pricing.ts"), "utf8");
  const code = src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
  const literals = (code.match(/(?<![\w.])\d+(?:\.\d+)?(?![\w])/g) ?? []).filter((n) => n !== "1" && n !== "0");
  assert.deepEqual(literals, []);
});

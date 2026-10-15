/** The Lusha reasons are declared twice (the library cannot be imported from src/app yet); this pins that they agree and have copy. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { contactActionErrorMessage } from "@/lib/contacts/labels";
import { t } from "@/lib/i18n/dictionaries";
import { LUSHA_REASONS } from "@/lib/lusha/reasons";

const source = readFileSync(join(__dirname, "..", "..", "src", "app", "(app)", "contacts", "actionErrors.ts"), "utf8");
const declared = [...source.matchAll(/\| "(lusha_[a-z_]+)"/g)].map((m) => m[1]);

test("ContactActionErrorReason declares exactly the library's Lusha reasons", () => {
  assert.deepEqual([...declared].sort(), [...LUSHA_REASONS].sort());
});

test("every Lusha reason has its own copy in both locales, none falling back to the generic error", () => {
  for (const locale of ["es", "en"] as const) {
    const d = t(locale);
    const l = { ...d.contactRecord, leadStatuses: d.leadStatuses };
    const messages = LUSHA_REASONS.map((r) => contactActionErrorMessage(l, r));
    assert.ok(messages.every((m) => typeof m === "string" && m.length > 0 && m !== l.genericError), locale);
    assert.equal(new Set(messages).size, LUSHA_REASONS.length, `${locale}: copy must be distinct per reason`);
  }
});

test("the account being out of credits reads differently from the daily cap and from a protected person", () => {
  const l = { ...t("es").contactRecord, leadStatuses: t("es").leadStatuses };
  const [credits, cap, protectedCopy] = ["lusha_no_credits", "lusha_cap_reached", "lusha_protected"].map((r) => contactActionErrorMessage(l, r as never));
  assert.equal(new Set([credits, cap, protectedCopy]).size, 3);
});

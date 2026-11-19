import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { AUTO_SEQUENCE_PREFIX, autoSequenceName, isAutoSequenceName } from "@/lib/prospecting/autoSequenceName";
import { es } from "@/lib/i18n/dictionaries/es";
import { en } from "@/lib/i18n/dictionaries/en";

describe("the automatic Sequence says what it actually is", () => {
  it("recognises its own Sequence by name, and nobody else's", () => {
    assert.ok(isAutoSequenceName(autoSequenceName("Cristian Civita")));
    for (const n of ["Florida + US · octubre", "Argentina", "", null, undefined]) {
      assert.ok(!isAutoSequenceName(n), String(n));
    }
  });

  it("never claims a human chose the contact or that the address is verified", () => {
    // The standard line says "elegidos a mano" and "correo verificado". On the automatic Sequence both are false,
    // and this is the screen where a send is decided - so the claim must not appear.
    for (const [locale, lead] of [["es", es.sequences.autoIntroLead], ["en", en.sequences.autoIntroLead]] as const) {
      assert.ok(lead.includes("{n}"), `${locale} keeps the count placeholder`);
      assert.doesNotMatch(lead, /a mano|by hand|verificado|verified/i, `${locale} must not claim hand-picked or verified`);
    }
    assert.match(es.sequences.introLead, /a mano/, "the standard line is unchanged");
  });

  it("the header picks the automatic line by name, and takes it from a DB-free module", () => {
    const header = readFileSync("src/app/(app)/sequences/_components/SequenceHeader.tsx", "utf8");
    assert.match(header, /isAutoSequenceName\(name\) \? labels\.autoIntroLead : labels\.introLead/);
    // A client component pulling @/db into the bundle is what serviceRoleBoundary.test.ts exists to stop; the
    // prefix lives in its own pure module precisely so this import is safe.
    const pure = readFileSync("src/lib/prospecting/autoSequenceName.ts", "utf8");
    assert.doesNotMatch(pure, /from "@\/db/);
    assert.ok(AUTO_SEQUENCE_PREFIX.length > 0);
  });
});

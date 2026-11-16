/**
 * Regression guard for the production outage of 2026-11-16: `/follow-ups` handed its label object straight to two
 * client components while two of its dictionary entries were FUNCTIONS (`rolesChipRemoveAria`, `rolesLeftOutMeta`).
 * Functions are not serializable across the server/client boundary, so every render threw. `next build` compiled it
 * and the whole unit suite stayed green, because nothing exercised what the page actually passes.
 *
 * So this checks the REAL producers the page calls (`roleGroupPanelLabels` / `roleGroupPanelRows`) against the REAL
 * dictionaries, not a hand-built copy that could drift from them. `structuredClone` is the check because it is the
 * same constraint React enforces at that boundary: it throws DataCloneError on a function.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { en } from "@/lib/i18n/dictionaries/en";
import { es } from "@/lib/i18n/dictionaries/es";
import { roleGroupPanelLabels, roleGroupPanelRows } from "@/lib/followUp/roleGroupPanelProps";
import { ROLE_GROUPS } from "@/lib/roleGroups";

const LOCALES = [
  ["en", en],
  ["es", es],
] as const;

describe("roleGroupPanelProps", () => {
  for (const [locale, dict] of LOCALES) {
    it(`${locale}: every label the page sends to the client survives structuredClone`, () => {
      const labels = roleGroupPanelLabels(dict.followUpsPage);
      assert.doesNotThrow(() => structuredClone(labels));
      assert.deepEqual(structuredClone(labels), labels);
    });

    it(`${locale}: every label value is a string, so none can be a dictionary function`, () => {
      const labels = roleGroupPanelLabels(dict.followUpsPage);
      const notStrings = Object.entries(labels).filter(([, v]) => typeof v !== "string");
      assert.deepEqual(notStrings, [], `non-string label values: ${JSON.stringify(notStrings.map(([k]) => k))}`);
    });

    it(`${locale}: the two placeholder labels keep their {label}/{n} tokens for the client to fill`, () => {
      const labels = roleGroupPanelLabels(dict.followUpsPage);
      assert.ok(labels.chipRemoveAria.includes("{label}"), `chipRemoveAria lost its {label}: ${labels.chipRemoveAria}`);
      assert.ok(labels.leftOutMeta.includes("{n}"), `leftOutMeta lost its {n}: ${labels.leftOutMeta}`);
    });

    it(`${locale}: every row the page sends to the client survives structuredClone`, () => {
      const rows = roleGroupPanelRows(dict.roleGroups);
      assert.doesNotThrow(() => structuredClone(rows));
      assert.deepEqual(structuredClone(rows), rows);
    });

    it(`${locale}: one row per role group, each with a label and a priority badge`, () => {
      const rows = roleGroupPanelRows(dict.roleGroups);
      assert.equal(rows.length, ROLE_GROUPS.length);
      assert.deepEqual(
        rows.map((r) => r.key),
        ROLE_GROUPS.map((g) => g.key),
      );
      for (const row of rows) {
        assert.equal(typeof row.label, "string");
        assert.ok(row.label.length > 0, `empty label for ${row.key}`);
        assert.ok(row.priorityClass.startsWith("badge"), `${row.key} priorityClass: ${row.priorityClass}`);
        assert.ok(row.priorityLabel.length > 0, `empty priorityLabel for ${row.key}`);
      }
    });
  }
});

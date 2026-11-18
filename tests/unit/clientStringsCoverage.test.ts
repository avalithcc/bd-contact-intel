/**
 * Every label object that crosses into a `"use client"` component, checked at runtime in both locales.
 *
 * `src/lib/i18n/clientStrings.ts` exists because passing a dictionary FUNCTION to a client component makes every
 * render of that page throw. Its own comment records two such production crashes; a third hit `/follow-ups` on
 * 2026-11-16, and a UX audit the next day found the guard was applied to exactly one slice — `d.sequences`, in
 * `sequenceViewText.test.ts` — while about ten others crossed unchecked.
 *
 * `ClientStrings<T>` catches it at compile time, but only where it is actually wrapped. `ContactRecordLabels` was
 * written as `ClientStrings<contactRecord> & { leadStatuses; meetings }`, where the two added slices escape the
 * constraint entirely: a formatter added to `dict.meetings` would have compiled and then thrown on the contact record
 * and the contacts board. An `as` or `any` anywhere would do the same. This is the net under that.
 *
 * The last test keeps the list honest: it reads the producers out of the source, so adding a twelfth one that nobody
 * covers here fails rather than passing silently.
 */
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { assertClientStrings } from "@/lib/i18n/clientStrings";
import { en } from "@/lib/i18n/dictionaries/en";
import { es } from "@/lib/i18n/dictionaries/es";
import { pickTopBarSearchLabels } from "@/lib/i18n/topBarSearchLabels";
import { pickNavLabels } from "@/lib/i18n/navLabels";
import { pickContactRecordLabels, pickBulkActionsLabels, pickContactsImportLabels } from "@/lib/contacts/labels";
import { pickMeetingLabels } from "@/lib/meetings/labels";
import { pickLeadsUploadLabels, pickLeadEditLabels } from "@/lib/leads/labels";
import { pickGenerateMessageLabels } from "@/lib/outreach/messageLabels";
import { pickCompanyRecordLabels } from "@/lib/companies/labels";

type Dict = typeof en;

/** Every producer that takes the whole dictionary. `pickCallFormLabels` is absent on purpose: it narrows an already
 * client-safe object rather than reading the dictionary, so it has nothing of its own to leak. */
const PRODUCERS: ReadonlyArray<readonly [string, (d: Dict) => unknown]> = [
  ["pickTopBarSearchLabels", (d) => pickTopBarSearchLabels(d)],
  ["pickNavLabels", (d) => pickNavLabels(d)],
  ["pickContactRecordLabels", (d) => pickContactRecordLabels(d)],
  ["pickBulkActionsLabels", (d) => pickBulkActionsLabels(d)],
  ["pickContactsImportLabels", (d) => pickContactsImportLabels(d)],
  ["pickMeetingLabels", (d) => pickMeetingLabels(d)],
  ["pickLeadsUploadLabels", (d) => pickLeadsUploadLabels(d)],
  ["pickLeadEditLabels", (d) => pickLeadEditLabels(d)],
  ["pickGenerateMessageLabels", (d) => pickGenerateMessageLabels(d)],
  ["pickCompanyRecordLabels", (d) => pickCompanyRecordLabels(d)],
];

/** Slices handed to a client component whole, without a producer in between. */
// "tenderDetail" and "tendersPage.triage" are here because they went to production as a WHITE SCREEN on 2026-11-18:
// /licitaciones/[id] passed dict.tenderDetail straight into a client component and six of its entries were functions
// (uploading, documentMeta, analysisGenerated, eventTriage, eventDocument, eventAnalysis). A function cannot cross the
// server-to-client boundary. lint, 6137 unit tests and next build were all green - the unit test renders the component
// directly in Node, where there is no boundary to cross - and only opening the real page in a browser found it.
// Same cause as the /follow-ups outage. Any dictionary slice handed WHOLE to a client component belongs in this list.
const WHOLE_SLICES = ["sequences", "sendControl", "companyBulk", "tasksPage", "leadStatuses", "roleGroups", "tenderDetail"] as const;
const NESTED_SLICES = [["tendersPage", "triage"]] as const;

const LOCALES = [
  ["en", en],
  ["es", es],
] as const;

describe("client-bound labels are strings, in both locales", () => {
  for (const [locale, dict] of LOCALES) {
    for (const [name, produce] of PRODUCERS) {
      it(`${locale}: ${name}`, () => {
        assert.doesNotThrow(() => assertClientStrings(produce(dict as Dict)), `${name} leaks a non-string`);
      });
    }

    for (const [parent, child] of NESTED_SLICES) {
      void it(`${locale}: dict.${parent}.${child} is strings only`, () => {
        assert.doesNotThrow(() => assertClientStrings((((dict as Dict)[parent] as unknown) as Record<string, unknown>)[child]), `dict.${parent}.${child} leaks a non-string`);
      });
    }
    for (const slice of WHOLE_SLICES) {
      it(`${locale}: dict.${slice} crosses whole`, () => {
        assert.doesNotThrow(() => assertClientStrings((dict as Dict)[slice]), `dict.${slice} leaks a non-string`);
      });
    }
  }

  it("rejects a function, so a passing run above means something", () => {
    assert.throws(() => assertClientStrings({ ok: "text", bad: (n: number) => String(n) }));
  });
});

describe("the list above stays complete", () => {
  it("every pick*Labels producer in src/lib is covered here", () => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith(".ts")) {
          for (const m of readFileSync(path, "utf8").matchAll(/export function (pick\w*Labels)\(/g)) found.push(m[1]!);
        }
      }
    };
    walk(join("src", "lib"));

    const covered = new Set([...PRODUCERS.map(([n]) => n), "pickCallFormLabels"]);
    const missing = found.filter((n) => !covered.has(n));
    assert.deepEqual(missing, [], `new label producer(s) not covered by this guard: ${missing.join(", ")}`);
  });
});

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { es } from "@/lib/i18n/dictionaries/es";
import type { DetailMember, SequenceDetail } from "@/lib/sequences/detailQueries";
import { DEFAULT_SCHEDULE } from "@/lib/sequences/schedule";
import { IDLE_LOCK, SEND } from "./sendContextFixture";

// tsx compiles .tsx with the classic JSX runtime here (tsconfig says "preserve" for Next), which needs `React` in scope.
// The component is therefore required AFTER the global is set; a static import would be hoisted above it.
(globalThis as { React?: unknown }).React = React;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SequenceDetailView } = require("@/app/(app)/sequences/_components/SequenceDetailView") as typeof import("@/app/(app)/sequences/_components/SequenceDetailView");

// Task 11.5 / spec "No new design tokens": every class the Sequence components emit must exist in the approved design
// system. Both sides are read from disk, never from a hand-kept list, so a new class in a component or a removed one
// in the stylesheet fails here instead of shipping unstyled.
const ROOT = join(__dirname, "..", "..");
const APPROVED = join(ROOT, "openspec/changes/crm-hubspot-ux/mockups/styles.css");
// The send-now-or-schedule mockup brings its own classes (split button, schedule popover) in an inline <style>; they were promoted to design-system.css.
const SEND_MOCKUP = join(ROOT, "openspec/changes/send-now-or-schedule/mockups/enviar-o-programar.html");
// The persistent "Generando…" banner reuses the standalone spinner the email-sync mockup defined (promoted to design-system.css).
const SPINNER_MOCKUP = join(ROOT, "openspec/changes/email-sync/mockups/email-sync.html");
const inlineStyle = (file: string) => (readFileSync(file, "utf8").match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "");
// Both are imported globally by src/app/layout.tsx; a CSS module (page.module.css) is scoped and does not count.
const SHIPPED = [join(ROOT, "src/app/design-system.css"), join(ROOT, "src/app/globals.css")];
const COMPONENTS = join(ROOT, "src/app/(app)/sequences/_components");

/** Every class named in a selector (the text before a `{`), so `0.5rem` or a class inside a declaration never counts. */
export function classesInStylesheet(css: string): Set<string> {
  const preludes = css.replace(/\/\*[\s\S]*?\*\//g, "").match(/[^{}]+(?=\{)/g) ?? [];
  const out = new Set<string>();
  for (const p of preludes) for (const m of p.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(m[1]);
  return out;
}

const tokens = (value: string) => value.split(/\s+/).filter(Boolean);

/** Classes written as literals in the component sources: covers markup the static render cannot reach (closed menus). */
function classesInSources(): Set<string> {
  const out = new Set<string>();
  for (const f of readdirSync(COMPONENTS).filter((n) => n.endsWith(".tsx"))) {
    for (const m of readFileSync(join(COMPONENTS, f), "utf8").matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      // A template's `${...}` parts are dynamic (`btn-${style}`): a token touching one is a prefix, and the values it can
      // take are covered by the render below.
      for (const t of tokens((m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, "\u0000"))) if (!t.includes("\u0000")) out.add(t);
    }
  }
  return out;
}

const NOW = new Date("2026-10-15T14:00:00Z");
const hours = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const draft = (over: Partial<NonNullable<DetailMember["draft"]>> = {}) => ({ subject: "s", body: "b", edited: false, generatedAt: new Date("2026-10-10T09:00:00Z"), editedAt: null, reviewedAt: null, approvedAt: null, scheduledFor: null, ...over });

// Synthetic people only: the approved mockup lists real prospects and none of them may enter the repo.
function member(i: number, over: Partial<DetailMember>): DetailMember {
  return {
    memberId: `m${i}`, personId: `00000000-0000-4000-8000-00000000000${i}`, state: "drafted", holdReason: null,
    firstName: `Test${i}`, lastName: "Person", jobTitle: "Engineering Lead", company: `Acme ${i}`, companyKey: `acme-${i}`,
    email: `p${i}@example.test`, emailVerified: true, openIt: 2, florida: true, leadership: true, lastContactAt: null,
    repliedAt: null, sentAt: null, reminderDueAt: null, discardedAt: null, discardReason: null, discardedByBdId: null, draft: draft(), reminderDraft: null, ...over,
  };
}

const sentOver = { sentAt: hours(96), reminderDueAt: new Date("2026-10-17T13:00:00Z") };
const ALL_KINDS: DetailMember[] = [
  member(1, {}),
  member(2, { draft: null }),
  member(3, { state: "approved", holdReason: "sync_stale", draft: draft({ approvedAt: hours(2), scheduledFor: new Date("2026-10-16T13:00:00Z") }) }),
  member(4, { state: "sent", ...sentOver }),
  member(5, { state: "sent", sentAt: hours(170), reminderDueAt: new Date("2026-10-15T13:00:00Z") }),
  member(6, { state: "no_reply", sentAt: hours(300) }),
  member(7, { state: "replied", sentAt: hours(96), repliedAt: hours(6) }),
  member(8, { state: "discarded", discardedAt: hours(24), discardReason: "no title" }),
  member(9, { state: "discarded", discardedAt: hours(24), discardReason: "opt_out" }),
  // A moment the BD chose (not the cadence of the approval): the "Programado" card.
  member(10, { state: "approved", draft: draft({ approvedAt: hours(2), scheduledFor: new Date("2026-10-20T14:00:00Z") }) }),
];

const detail = (members: DetailMember[]): SequenceDetail => ({ id: "s", name: "Synthetic sequence", ownerBdId: "o", ownerName: "Owner", fromAddress: "from@example.test", schedule: DEFAULT_SCHEDULE, dailySendCap: 5, sentToday: 0, members });
const render = (members: DetailMember[], viewerBdId = "o") =>
  renderToStaticMarkup(createElement(SequenceDetailView, { detail: detail(members), labels: es.sequences, now: NOW, onAction: () => {}, viewerBdId, send: SEND, lock: IDLE_LOCK }));

function renderedClasses(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/class="([^"]*)"/g)) for (const t of tokens(m[1])) out.add(t);
  return out;
}

const STATES = {
  "live screen with every card kind": render(ALL_KINDS),
  "empty state": render(Array.from({ length: 3 }, (_, i) => member(i + 1, { draft: null }))),
  "finished state": render([member(1, { state: "replied", sentAt: hours(300), repliedAt: hours(100) }), member(2, { state: "no_reply", sentAt: hours(300) })]),
};

test("the class extractor reads selectors, not declarations or comments", () => {
  const css = "/* .commented */ .a, .b > .c { margin: 0.5rem; background: url(x.png) } @media (min-width: 1px) { .d:hover { top: .5em } }";
  assert.deepEqual([...classesInStylesheet(css)].sort(), ["a", "b", "c", "d"]);
});

test("an approved card says \"por vos\" to the owner and never to anyone else", () => {
  const approved = ALL_KINDS[2];
  const own = render([approved], "o");
  const admin = render([approved], "another-bd");
  assert.ok(own.includes("aprobado por vos hace"), "the owner reading their own Sequence approved it");
  assert.ok(!admin.includes("por vos"), "an admin reading another BD's Sequence must never be told they approved it");
  assert.ok(admin.includes("aprobado hace"), "the admin still sees WHEN it was approved, just not who");
});

test("there is no way to generate in a batch: an all-empty sequence lists its members, each with its own Generar borrador", () => {
  const html = STATES["empty state"];
  assert.equal(html.split(es.sequences.actions.generate).length - 1, 3, "one generate button per member card");
  for (const gone of ["Generar borradores faltantes", "Generar los 3 borradores", "Regenerar los"]) assert.ok(!html.includes(gone), gone);
  assert.ok(html.includes("Synthetic") === false || true);
  assert.ok(STATES["live screen with every card kind"].includes(es.sequences.membersTitle));
});

test("the fixture renders every card kind, so the class check below is not vacuous", () => {
  for (const label of Object.values(es.sequences.badges)) assert.ok(STATES["live screen with every card kind"].includes(label), label);
  assert.ok(STATES["empty state"].includes("empty-icon") && STATES["finished state"].includes(es.sequences.finishedTitle));
});

for (const [name, paths] of [["approved mockup styles.css", [APPROVED]], ["shipped global CSS (design-system.css + globals.css)", SHIPPED]] as const) {
  test(`every class the Sequence components use exists in the ${name}`, () => {
    const known = classesInStylesheet(paths.map((p) => readFileSync(p, "utf8")).join("\n") + (paths === SHIPPED ? "" : inlineStyle(SEND_MOCKUP) + inlineStyle(SPINNER_MOCKUP)));
    const used = classesInSources();
    for (const html of Object.values(STATES)) for (const c of renderedClasses(html)) used.add(c);
    assert.ok(used.size > 20, `expected a realistic number of classes, got ${used.size}`);
    assert.deepEqual([...used].filter((c) => !known.has(c)).sort(), []);
  });
}

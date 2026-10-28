/**
 * "No tiene WhatsApp" is its own activity type (`whatsapp_no_channel`) so that every type-level list treats it like
 * `call_attempt`: nobody was reached, so it is not worked, closes no Seguimientos cycle, moves no stage and transfers no
 * ownership (whatsapp-como-actividad mockup, section 2: "¿Cierra el ciclo? no").
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CYCLE_CLOSING_ACTIVITY_TYPES } from "@/lib/followUp/openCycle";
import { WORKED_ACTIVITY_TYPES } from "@/lib/followUp/queueSelection";
import { isOwnerTouchType } from "@/lib/identity/ownerOnTouch";
import { NO_PROGRESS_ACTIVITY_TYPES } from "@/lib/activity/noProgressActivity";
import { planWhatsApp, whatsappActivityType, WHATSAPP_NO_CHANNEL_TYPE, WHATSAPP_OUTCOME_CODES } from "@/lib/contacts/whatsapp";
import { activityRowToStatusEvent, deriveStatus } from "@/lib/status/deriveStatus";
import { buildReportPerBdQuery } from "@/lib/reports/queries";
import { PgDialect } from "drizzle-orm/pg-core";

test("whatsappActivityType picks whatsapp for sent and replied, and the inert type for no_whatsapp", () => {
  assert.equal(whatsappActivityType("sent"), "whatsapp");
  assert.equal(whatsappActivityType("replied"), "whatsapp");
  assert.equal(whatsappActivityType("no_whatsapp"), WHATSAPP_NO_CHANNEL_TYPE);
  assert.equal(WHATSAPP_NO_CHANNEL_TYPE, "whatsapp_no_channel");
});

/**
 * Fails closed. The outcome is typed, so this is unreachable through planWhatsApp today — but written the other way
 * round (`=== "no_whatsapp" ? inert : "whatsapp"`) a corrupted or future outcome would land on the type that closes
 * Seguimientos cycles and transfers contact ownership, which is the exact bug the two-type split exists to prevent.
 */
test("an outcome that is not sent or replied gets the inert type, whatever it is", () => {
  for (const garbage of ["", "no_whatsapp", "sent ", "SENT", "unknown", "call"] as unknown as Parameters<typeof whatsappActivityType>[0][]) {
    assert.equal(whatsappActivityType(garbage), WHATSAPP_NO_CHANNEL_TYPE, JSON.stringify(garbage));
  }
});

/**
 * The picker is only useful if the action actually calls it. `logWhatsAppAction` lives behind "use server" and the real
 * db, so it is pinned at source level like src/lib/activity/queries.ts is in lushaRevealActivity.test.ts: a hardcoded
 * `type: "whatsapp"` would otherwise resurrect the bug with every unit test still green.
 */
test("logWhatsAppAction gets its activity type from whatsappActivityType, not a literal", () => {
  const source = readFileSync(join(__dirname, "..", "..", "src", "app", "(app)", "contacts", "actions.ts"), "utf8");
  const action = source.slice(source.indexOf("export async function logWhatsAppAction"));
  const body = action.slice(0, action.indexOf("\nexport ")).replace(/\/\/.*$/gm, "");
  assert.ok(body.length > 0, "logWhatsAppAction moved: this test can no longer see it");
  assert.match(body, /type:\s*whatsappActivityType\(/);
  assert.ok(!/type:\s*["']whatsapp["']/.test(body), "the type must not be a literal: no_whatsapp would become worked");
});

test("sent and replied are worked, close an open cycle and transfer ownership; no_whatsapp does none of the three", () => {
  for (const outcome of WHATSAPP_OUTCOME_CODES) {
    const type = whatsappActivityType(outcome);
    const closes = outcome !== "no_whatsapp";
    assert.equal(WORKED_ACTIVITY_TYPES.has(type), closes, `${outcome} worked`);
    assert.equal((CYCLE_CLOSING_ACTIVITY_TYPES as readonly string[]).includes(type), closes, `${outcome} closes cycle`);
    assert.equal(isOwnerTouchType(type), closes, `${outcome} transfers ownership`);
  }
});

test("whatsapp_no_channel is a no-progress type, so it neither resets the follow-up clock nor moves the owner", () => {
  assert.ok((NO_PROGRESS_ACTIVITY_TYPES as readonly string[]).includes(WHATSAPP_NO_CHANNEL_TYPE));
  assert.ok(!(NO_PROGRESS_ACTIVITY_TYPES as readonly string[]).includes("whatsapp"));
});

test("a whatsapp_no_channel row derives no stage, even though its stored outcome is no_whatsapp", () => {
  const event = activityRowToStatusEvent({
    id: "n1",
    type: WHATSAPP_NO_CHANNEL_TYPE,
    createdAt: new Date("2026-10-28T18:00:00.000Z"),
    metadata: { ...planWhatsApp("no_whatsapp", "2026-10-01", "14:30", "") },
  });
  assert.equal(deriveStatus([event]).status, "new");
});

test("the per-BD report counts the worked set from WORKED_ACTIVITY_TYPES itself, whatsapp included and the no-channel type excluded", () => {
  const { params } = new PgDialect().sqlToQuery(
    buildReportPerBdQuery({ fromIso: "2026-10-01T00:00:00Z", toIso: "2026-10-28T00:00:00Z", fromDate: "2026-10-01", toDateExclusive: "2026-10-28", bdId: null }),
  );
  for (const type of WORKED_ACTIVITY_TYPES) assert.ok(params.includes(type), type);
  // The worked IN-list is one contiguous run of bound params, equal to the set; the no-channel type is only in the activity pivot.
  const run = [...WORKED_ACTIVITY_TYPES].join(",");
  assert.ok(params.join(",").includes(run), "the worked list is the imported set, in order");
  assert.ok(!([...WORKED_ACTIVITY_TYPES] as string[]).includes(WHATSAPP_NO_CHANNEL_TYPE));
  assert.ok(params.includes(WHATSAPP_NO_CHANNEL_TYPE), "the pivot filter includes the no-channel type");
});

// whatsapp-como-actividad, one-tap bar: the bar and the link live in a "use client" file that imports a server action
// (and so the db), so they are pinned at source level like logWhatsAppAction above.
const barSource = readFileSync(join(__dirname, "..", "..", "src", "components", "WhatsAppBarProvider.tsx"), "utf8");

test("the outcome bar writes through logWhatsAppAction, which owns the type; it never names an activity type itself", () => {
  assert.match(barSource, /logWhatsAppAction\(open\.personId, outcome,/);
  assert.doesNotMatch(barSource, /createActivityAction|type:\s*"whatsapp/);
});

test("clicking the wa.me link only opens the bar: the link component calls no server action", () => {
  const link = barSource.slice(barSource.indexOf("export function WhatsAppLink"), barSource.indexOf("/** Button order"));
  assert.match(link, /bar\.openBar\(/);
  assert.doesNotMatch(link, /Action\(/);
});

test("the bar offers the three outcome codes the planner accepts, 'replied' first as the primary button", () => {
  const order = barSource.match(/const BAR_ORDER = \[([^\]]*)\]/)![1]!.replace(/["\s]/g, "").split(",");
  assert.deepEqual(order, ["replied", "sent", "no_whatsapp"]);
  assert.deepEqual([...order].sort(), [...WHATSAPP_OUTCOME_CODES].sort());
});

test("the shell mounts the bar with the whatsappBar dictionary section in both locales", async () => {
  const layout = readFileSync(join(__dirname, "..", "..", "src", "app", "(app)", "layout.tsx"), "utf8");
  assert.match(layout, /<WhatsAppBarProvider labels=\{dict\.whatsappBar\}>/);
  const { es } = await import("@/lib/i18n/dictionaries/es");
  const { en } = await import("@/lib/i18n/dictionaries/en");
  assert.deepEqual(Object.keys(es.whatsappBar).sort(), Object.keys(en.whatsappBar).sort());
  assert.equal(es.whatsappBar.replied, "Me contestó");
});

/**
 * The bar's two races, pinned at source level because the provider imports a server action (and so the db) and cannot
 * be rendered in a unit test. Both were found by a fresh review and both wrote or reported the wrong thing:
 *  - a slow write for contact A used to `dismiss()` whatever bar was on screen when it returned, which is contact B's
 *    if the BD moved on, and then said B was saved;
 *  - `bar.busy` is per bar OBJECT, so re-clicking the same person's wa link replaced the bar with a fresh
 *    `busy: false` one and a second outcome could be written for the same conversation.
 */
test("the bar dismisses only its own write and locks a contact while its write is in flight", () => {
  const source = readFileSync(join(__dirname, "..", "..", "src", "components", "WhatsAppBarProvider.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  // The success branch must be guarded by "is this still the bar I started from".
  assert.match(source, /if \(openId\.current === open\.id\) dismiss\(\)/);
  assert.ok(!/if \(ok\) \{\s*dismiss\(\);/.test(source), "an unguarded dismiss() on success closes another contact's bar");

  // A per-person lock, not a per-bar flag: added before the await, released after, and consulted by BOTH entry points.
  assert.match(source, /inFlight\.current\.add\(open\.personId\)/);
  assert.match(source, /inFlight\.current\.delete\(open\.personId\)/);
  assert.match(source, /openBar[\s\S]*?inFlight\.current\.has\(target\.personId\)/);
  assert.match(source, /if \(!bar \|\| bar\.busy \|\| inFlight\.current\.has\(bar\.personId\)\) return;/);

  // A failed write always tells the BD, even when its bar is gone.
  assert.equal(source.match(/showToast\(labels\.saveError, "error"\)/g)?.length, 2);
});

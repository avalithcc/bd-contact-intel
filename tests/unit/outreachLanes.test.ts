import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyLaneFilters,
  DEFAULT_OUTREACH_LANE,
  laneOffersFilter,
  laneUrl,
  legacyViewRedirect,
  OUTREACH_LANES,
  resolveOutreachLane,
} from "@/lib/outreach/lanes";
import type { OutreachFilters } from "@/lib/outreach/ranking";
import { en } from "@/lib/i18n/dictionaries/en";
import { es } from "@/lib/i18n/dictionaries/es";

test("resolveOutreachLane: absent, unknown, array and empty values fall back to hiring without throwing", () => {
  assert.equal(DEFAULT_OUTREACH_LANE, "hiring");
  assert.equal(resolveOutreachLane(undefined), "hiring");
  assert.equal(resolveOutreachLane(""), "hiring");
  assert.equal(resolveOutreachLane("bogus"), "hiring");
  assert.equal(resolveOutreachLane("HIRING"), "hiring");
  assert.equal(resolveOutreachLane(["ready_for_email", "hiring"] as unknown as string), "hiring");
});

test("resolveOutreachLane: both valid values resolve to themselves", () => {
  assert.deepEqual([...OUTREACH_LANES], ["hiring", "ready_for_email"]);
  assert.equal(resolveOutreachLane("hiring"), "hiring");
  assert.equal(resolveOutreachLane("ready_for_email"), "ready_for_email");
});

const FULL: OutreachFilters = {
  roleGroup: "c_level_tech",
  companyCategory: "fintech" as never,
  name: "ada",
  includeNeverMessaged: false,
  market: "us",
  miamiOnly: true,
  hideOffshore: true,
  startupsOnly: true,
};

test("applyLaneFilters: ready_for_email drops every posting-derived filter and excludeNever, keeps the three shared ones", () => {
  const out = applyLaneFilters("ready_for_email", FULL);
  assert.deepEqual(out, { roleGroup: "c_level_tech", companyCategory: "fintech", name: "ada" });
  for (const k of ["market", "miamiOnly", "hideOffshore", "startupsOnly", "includeNeverMessaged"] as const) {
    assert.equal(k in out, false, `${k} must not survive in ready_for_email`);
    assert.equal(laneOffersFilter("ready_for_email", k), false);
    assert.equal(laneOffersFilter("hiring", k), true);
  }
});

test("applyLaneFilters: hiring keeps the full panel unchanged", () => {
  assert.deepEqual(applyLaneFilters("hiring", FULL), FULL);
});

test("applyLaneFilters is pure: same input twice gives the same output and the input is not mutated", () => {
  const input = structuredClone(FULL);
  const first = applyLaneFilters("ready_for_email", input);
  const second = applyLaneFilters("ready_for_email", input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, FULL);
  assert.notEqual(applyLaneFilters("hiring", input), input);
});

test("legacyViewRedirect maps the retired moveToEmail view to the ready_for_email lane and nothing else", () => {
  assert.equal(legacyViewRedirect("moveToEmail"), "/contacts?view=outreach&lane=ready_for_email");
  for (const v of [undefined, "all", "outreach", "bogus"]) assert.equal(legacyViewRedirect(v), null);
});

test("legacyViewRedirect forwards the rest of the query string but never a stale view or lane", () => {
  const url = legacyViewRedirect("moveToEmail", { q: "ana", page: "3", roles: "all", view: "moveToEmail", lane: "hiring", status: ["a", "b"] });
  const params = new URL(url!, "http://x").searchParams;
  assert.equal(params.get("view"), "outreach");
  assert.deepEqual(params.getAll("lane"), ["ready_for_email"]);
  assert.equal(params.get("q"), "ana");
  assert.equal(params.get("page"), "3");
  assert.equal(params.get("roles"), "all");
  assert.deepEqual(params.getAll("status"), ["a", "b"]);
});

test("laneUrl carries roles=all and nothing else of roles", () => {
  assert.equal(laneUrl("hiring"), "/contacts?view=outreach&lane=hiring");
  assert.equal(laneUrl("ready_for_email", "all"), "/contacts?view=outreach&lane=ready_for_email&roles=all");
  assert.equal(laneUrl("hiring", "nope"), "/contacts?view=outreach&lane=hiring");
});

for (const [name, d] of [["es", es], ["en", en]] as const) {
  test(`${name} hiring legend: the company-count sentence is dropped at 0 and singular at 1`, () => {
    const zero = d.outreach.laneHiringLegend(0);
    const one = d.outreach.laneHiringLegend(1);
    const many = d.outreach.laneHiringLegend(117);
    assert.equal(zero.includes("0"), false);
    assert.ok(one.includes("1 "));
    assert.ok(many.includes("117"));
    assert.ok(zero.length < one.length);
    assert.notEqual(one.replace("1", "117"), many);
  });

  test(`${name} ready legend interpolates the live numbers and never prints a literal placeholder`, () => {
    const text = d.outreach.laneReadyLegend(3014, 2973, 87, 44);
    for (const n of ["2973", "87", "44"]) assert.ok(text.includes(n), n);
    assert.equal(/[{}]|undefined|NaN/.test(text), false);
  });
}

test("es ready legend singularizes at 1 and keeps the approved plural wording otherwise", () => {
  const plural = es.outreach.laneReadyLegend(3014, 2973, 87, 44);
  assert.equal(
    plural,
    "Están acá porque tienen el correo verificado, ya figuran como contactados y nunca respondieron: el próximo paso es un correo. De dónde viene ese «contactado»: 2973 del import de HubSpot, 87 de un correo que les mandamos desde el CRM y 44 de un mensaje de LinkedIn.",
  );
  const one = es.outreach.laneReadyLegend(1, 1, 1, 1);
  assert.ok(one.startsWith("Está acá porque tiene el correo verificado, ya figura como contactado y nunca respondió"));
  assert.ok(one.includes("1 de un correo que le mandamos"));
});

test("es hiring legend matches the approved copy", () => {
  assert.equal(
    es.outreach.laneHiringLegend(117),
    "La empresa tiene avisos de IT abiertos y frescos. Hoy hay 117 empresas en esa condición.",
  );
  assert.equal(es.outreach.laneHiringLegend(0), "La empresa tiene avisos de IT abiertos y frescos.");
});

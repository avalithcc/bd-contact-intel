import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { es } from "@/lib/i18n/dictionaries/es";
import { sequenceStats, type StatMember } from "@/lib/sequences/stats";

(globalThis as { React?: unknown }).React = React;
/* eslint-disable @typescript-eslint/no-require-imports */
const { StatCards } = require("@/app/(app)/sequences/_components/StatCards") as typeof import("@/app/(app)/sequences/_components/StatCards");
/* eslint-enable @typescript-eslint/no-require-imports */

const NOW = new Date("2026-10-15T14:00:00Z");
const SENT_AT = new Date("2026-10-14T13:00:00Z");
const m = (state: StatMember["state"], over: Partial<StatMember> = {}): StatMember => ({ state, hasDraft: true, scheduledFor: null, sentAt: null, discardReason: null, ...over });

test("the fifth tile is 'No contactables': warn tone, the not-contactable count (not Enviados), and the rate as its foot", () => {
  const stats = sequenceStats([m("sent", { sentAt: SENT_AT }), m("sent", { sentAt: SENT_AT }), m("replied", { sentAt: SENT_AT }), m("discarded", { sentAt: SENT_AT, discardReason: "bounce" }), m("discarded", { sentAt: SENT_AT, discardReason: "opt_out" }), m("discarded", { sentAt: SENT_AT, discardReason: "bounce" })]);
  const html = renderToStaticMarkup(createElement(StatCards, { stats, now: NOW, labels: es.sequences }));
  assert.ok(html.includes("grid-5"));
  const tile = html.split('<div class="stat ').find((t) => t.startsWith("warn"));
  assert.ok(tile, "a warn tile exists");
  assert.ok(tile.includes(">No contactables<"));
  assert.ok(tile.includes('<div class="value">3</div>'));
  assert.ok(tile.includes("50% de los que salieron"));
  assert.ok(html.includes('<div class="value">6</div>'), "Enviados counts the 6 that went out");
});

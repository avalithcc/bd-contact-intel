import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { placeBubble } from "@/lib/ui/tooltipPosition";

(globalThis as { React?: unknown }).React = React;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Tooltip } = require("@/components/Tooltip") as typeof import("@/components/Tooltip");

const VIEWPORT = { width: 1024, height: 768 };
const BUBBLE = { width: 280, height: 100 };
const box = (left: number, top: number, width = 80, height = 20) => ({ left, top, right: left + width, bottom: top + height });

test("the bubble opens below the trigger, aligned to its start", () => {
  const p = placeBubble({ trigger: box(100, 200), bubble: BUBBLE, viewport: VIEWPORT, align: "start" });
  assert.deepEqual(p, { top: 226, left: 100, placement: "below" });
});

test("align end puts the bubble's right edge on the trigger's right edge", () => {
  const p = placeBubble({ trigger: box(700, 200), bubble: BUBBLE, viewport: VIEWPORT, align: "end" });
  assert.equal(p.left, 780 - 280);
});

test("the bubble never leaves the viewport horizontally", () => {
  assert.equal(placeBubble({ trigger: box(950, 200), bubble: BUBBLE, viewport: VIEWPORT, align: "start" }).left, 1024 - 280 - 8);
  assert.equal(placeBubble({ trigger: box(2, 200), bubble: BUBBLE, viewport: VIEWPORT, align: "end" }).left, 8);
});

test("near the bottom edge the bubble flips above the trigger", () => {
  const p = placeBubble({ trigger: box(100, 700), bubble: BUBBLE, viewport: VIEWPORT, align: "start" });
  assert.deepEqual(p, { top: 700 - 6 - 100, left: 100, placement: "above" });
});

test("when neither side fits it stays below rather than going off the top", () => {
  const p = placeBubble({ trigger: box(100, 40), bubble: { width: 280, height: 900 }, viewport: VIEWPORT, align: "start" });
  assert.equal(p.placement, "below");
});

test("the trigger is focusable and described by a role=tooltip bubble that exists in the markup, hidden", () => {
  const html = renderToStaticMarkup(
    createElement(Tooltip, { title: "Conexión", body: "Si Gmail está autorizado.", action: "Usa el botón.", actionLabel: "Qué hacer:", variant: "header", children: "Conexión" }),
  );
  const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1];
  assert.ok(describedBy, "the trigger has aria-describedby");
  assert.match(html, new RegExp(`role="tooltip"[^>]*id="${describedBy}"|id="${describedBy}"[^>]*role="tooltip"`));
  assert.match(html, /tabindex="0"/);
  assert.match(html, /hidden=""/);
  assert.match(html, /<strong>Qué hacer:<\/strong> Usa el botón\./);
  assert.match(html, /tip-hdr/);
});

test("a tooltip without an action line renders no 'what to do' row", () => {
  const html = renderToStaticMarkup(createElement(Tooltip, { title: "Último email", body: "Fecha del último email.", actionLabel: "Qué hacer:", children: "x" }));
  assert.doesNotMatch(html, /Qué hacer/);
});

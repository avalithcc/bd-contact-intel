import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { es } from "@/lib/i18n/dictionaries/es";
import { en } from "@/lib/i18n/dictionaries/en";
import type { ConnectionBannerDecision } from "@/lib/gmail/connectionBanner";

(globalThis as { React?: unknown }).React = React;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ConnectionBanner } = require("@/components/ConnectionBanner") as typeof import("@/components/ConnectionBanner");

const render = (decision: ConnectionBannerDecision, sinceText: string | null = null, labels = es.connectionBanner) =>
  renderToStaticMarkup(createElement(ConnectionBanner, { decision, labels, sinceText }));

const ALL: ConnectionBannerDecision[] = [
  { tone: "danger", reason: "disconnected" },
  { tone: "danger", reason: "missing_scope" },
  { tone: "danger", reason: "expired", sinceMs: 1 },
  { tone: "warn", reason: "stale" },
  { tone: "warn", reason: "failing" },
];

test("every banner is an alert with a real link to /account/email and no close button", () => {
  for (const d of ALL) {
    const html = render(d, "hace 3 horas");
    assert.match(html, /role="alert"/);
    assert.match(html, /<a [^>]*href="\/account\/email"/);
    assert.doesNotMatch(html, /<button/);
  }
});

test("red cases use the danger modifier; amber cases do not", () => {
  for (const d of ALL) assert.equal(render(d).includes("reconnect-banner-danger"), d.tone === "danger");
});

test("expired renders the since-when text from the mockup, in es and en", () => {
  const d: ConnectionBannerDecision = { tone: "danger", reason: "expired", sinceMs: 1 };
  assert.match(render(d, "hace 3 horas"), /Se venció el permiso de tu Gmail\. <strong>Es clave que lo reconectes ahora:<\/strong> desde hace 3 horas tus correos no entran al CRM\./);
  assert.match(render(d, "3 hours ago", en.connectionBanner), /since 3 hours ago/);
  assert.doesNotMatch(render(d, null), /desde/);
});

test("disconnected copy matches the mockup word for word", () => {
  assert.match(
    render({ tone: "danger", reason: "disconnected" }),
    /Tu Gmail está desconectado\. <strong>Es clave que lo reconectes ahora:<\/strong> mientras tanto tus correos no entran al CRM y tus secuencias quedan frenadas\./,
  );
});

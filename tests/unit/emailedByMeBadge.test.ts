import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { es } from "@/lib/i18n/dictionaries/es";
import { en } from "@/lib/i18n/dictionaries/en";

(globalThis as { React?: unknown }).React = React;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { EmailedByMeBadge } = require("@/app/(app)/follow-ups/EmailedByMeBadge") as typeof import("@/app/(app)/follow-ups/EmailedByMeBadge");

const render = (emailedByMe: boolean, l = es.followUpsPage) =>
  renderToStaticMarkup(createElement(EmailedByMeBadge, { emailedByMe, label: l.emailedByMeBadge, title: l.emailedByMeTitle }));

test("renders nothing when the BD did not email the contact personally", () => {
  assert.equal(render(false), "");
});

test("renders the label with an explanatory title when true, in both languages", () => {
  const es_ = render(true);
  assert.match(es_, /Le escribiste/);
  assert.match(es_, /title="[^"]+"/);
  const en_ = render(true, en.followUpsPage as typeof es.followUpsPage);
  assert.match(en_, /You emailed/);
  assert.match(en_, /title="[^"]+"/);
});

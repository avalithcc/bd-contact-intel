import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { postingAdHref } from "@/lib/hiring/postingRow";
import type { OpenPosting } from "@/lib/hiring/postingRow";
import { es } from "@/lib/i18n/dictionaries/es";

(globalThis as { React?: unknown }).React = React;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { HiringPostingsTable } = require("@/app/(app)/companies/[key]/HiringPostingsTable") as typeof import("@/app/(app)/companies/[key]/HiringPostingsTable");

const posting = (over: Partial<OpenPosting>): OpenPosting => ({
  id: "1", title: "Senior Engineer", location: "Austin, TX", market: "us", url: "https://boards.example.test/jobs/1",
  postedAt: null, firstSeen: new Date("2026-09-16T12:00:00Z"), ...over,
});
const render = (postings: OpenPosting[]) =>
  renderToStaticMarkup(createElement(HiringPostingsTable, { postings, labels: es.companyRecord, markets: es.markets }));

test("postingAdHref only lets http(s) URLs through", () => {
  assert.equal(postingAdHref("https://a.test/x"), "https://a.test/x");
  assert.equal(postingAdHref("http://a.test/x"), "http://a.test/x");
  for (const bad of ["", "   ", "javascript:alert(1)", "JAVASCRIPT:alert(1)", "java\tscript:alert(1)", "//evil.com", "/relative", "ftp://a.test", "not a url", null, undefined]) {
    assert.equal(postingAdHref(bad as string | null | undefined), null, String(bad));
  }
});

test("the position title links to the original ad in a new tab when the URL is usable", () => {
  const html = render([posting({})]);
  assert.match(html, /<a href="https:\/\/boards\.example\.test\/jobs\/1" target="_blank" rel="noreferrer">Senior Engineer<\/a>/);
});

test("a missing or non-http URL renders the title as plain text, never a dead link", () => {
  for (const url of ["", "javascript:alert(1)"]) {
    const html = render([posting({ url })]);
    assert.doesNotMatch(html, /<a /);
    assert.match(html, /<td>Senior Engineer<\/td>/);
  }
});

test("the Publicado column is gone: no header and no date cell", () => {
  const html = render([posting({})]);
  assert.doesNotMatch(html, /Publicado/);
  assert.equal((html.match(/<th>/g) ?? []).length, 3);
  assert.equal((html.match(/<td/g) ?? []).length, 3);
  assert.equal("hiringTablePosted" in es.companyRecord, false);
});

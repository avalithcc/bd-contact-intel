import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { canExpandLoneEmailBody, type LoneEmailRow } from "@/lib/contacts/loneEmailBody";
import { groupEmailThreads } from "@/lib/contacts/emailThreads";

(globalThis as { React?: unknown }).React = React;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { LoneEmailBody, MailBodyText } = require("@/app/(app)/contacts/[id]/MailBody") as typeof import("@/app/(app)/contacts/[id]/MailBody");

const ME = "bd-me";
const row = (over: Partial<LoneEmailRow> = {}): LoneEmailRow => ({
  type: "email_sent",
  actorBdId: ME,
  visible: true,
  metadata: { gmailThreadId: "t1", gmailMessageId: "m1" },
  ...over,
});
// One viewer is enough: the predicate is about OWNERSHIP, never about the me role (an me reading another
// BD's lone mail already gets its body inline from renderForeignMailBody, with no button). The old fixtures
// differed only by an `isAdmin` flag the predicate never read, so every "me" case asserted the same thing twice.
const me = { id: ME };

test("own email gets the button, me or not", () => {
  assert.equal(canExpandLoneEmailBody(row(), me), true);
  assert.equal(canExpandLoneEmailBody(row(), me), true);
});
test("inbound types are covered", () => {
  assert.equal(canExpandLoneEmailBody(row({ type: "reply_received" }), me), true);
  assert.equal(canExpandLoneEmailBody(row({ type: "auto_reply_received" }), me), true);
});
test("foreign mail seen by an me renders inline: no button", () => {
  assert.equal(canExpandLoneEmailBody(row({ actorBdId: "other" }), me), false);
});
test("foreign mail for a non-admin never gets a button", () => {
  assert.equal(canExpandLoneEmailBody(row({ actorBdId: "other" }), me), false);
});
test("no actor means no button (the read is scoped to the viewer)", () => {
  assert.equal(canExpandLoneEmailBody(row({ actorBdId: null }), me), false);
});
test("missing thread id or message id: no button", () => {
  assert.equal(canExpandLoneEmailBody(row({ metadata: { gmailMessageId: "m1" } }), me), false);
  assert.equal(canExpandLoneEmailBody(row({ metadata: { gmailThreadId: "t1" } }), me), false);
  assert.equal(canExpandLoneEmailBody(row({ metadata: null }), me), false);
});
test("non-email types and locked rows: no button", () => {
  assert.equal(canExpandLoneEmailBody(row({ type: "note" }), me), false);
  assert.equal(canExpandLoneEmailBody(row({ type: "call" }), me), false);
  assert.equal(canExpandLoneEmailBody(row({ visible: false }), me), false);
});

const labels = { show: "Ver mensaje", hide: "Ocultar mensaje", truncatedNote: "TRUNC", empty: "VACIO" };
const render = (r: LoneEmailRow, viewer = me, extra: Partial<Parameters<typeof LoneEmailBody>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(LoneEmailBody, { row: r, viewer, expanded: false, loading: false, bodies: undefined, labels, onToggle: () => {}, ...extra }),
  );

test("a lone own email row renders the collapsed button and no body", () => {
  const html = render(row());
  assert.match(html, /<button[^>]*aria-expanded="false"/);
  assert.match(html, /Ver mensaje/);
  assert.doesNotMatch(html, /snippet/);
});
test("the foreign-admin row renders no button (its body is inline)", () => {
  assert.equal(render(row({ actorBdId: "other" }), me), "");
});
test("a row without gmailMessageId renders nothing", () => {
  assert.equal(render(row({ metadata: { gmailThreadId: "t1" } })), "");
});
test("expanded with a loaded body shows it and the truncated note", () => {
  const html = render(row(), me, {
    expanded: true,
    bodies: { m1: { gmailMessageId: "m1", bodyText: "Hola Federico", bodyTruncated: true } },
  });
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /Ocultar mensaje/);
  assert.match(html, /<div class="snippet"[^>]*>Hola Federico<\/div>/);
  assert.match(html, /TRUNC/);
});
test("expanded and not truncated: no note; loading: spinner, no body", () => {
  const bodies = { m1: { gmailMessageId: "m1", bodyText: "Hola", bodyTruncated: false } };
  assert.doesNotMatch(render(row(), me, { expanded: true, bodies }), /TRUNC/);
  const loading = render(row(), me, { expanded: true, loading: true });
  assert.match(loading, /spinner/);
  assert.doesNotMatch(loading, /snippet/);
});
test("loaded but no stored body shows the empty note", () => {
  const html = render(row(), me, { expanded: true, bodies: {} });
  assert.match(html, /VACIO/);
});
test("MailBodyText renders the note only when truncated", () => {
  assert.match(renderToStaticMarkup(createElement(MailBodyText, { text: "x", truncated: true, truncatedNote: "NOTE" })), /NOTE/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(MailBodyText, { text: "x", truncated: false, truncatedNote: "NOTE" })), /NOTE/);
});

test("groupEmailThreads still returns 'single' for a one-message thread (the button lives on the single row)", () => {
  const entry = { id: "s1", type: "email_sent", createdAt: new Date(0), at: new Date(0), metadata: { gmailThreadId: "t1", gmailMessageId: "m1" }, visible: true };
  assert.deepEqual(groupEmailThreads([entry]), [{ kind: "single", entry }]);
});

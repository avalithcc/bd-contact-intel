import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { renderUnsubscribeHtml } from "@/lib/sequences/unsubscribeHtml";
import { generateUnsubscribeToken } from "@/lib/sequences/unsubscribeToken";

// The three recipient-facing screens of baja-opciones.html (Option B, screens 2 and 3 plus the generic invalid page). A
// route handler cannot render React (Next refuses react-dom/server there), so the markup is built as an escaped string.

const ROOT = join(__dirname, "..", "..");
const css = ["design-system.css", "globals.css"].map((f) => readFileSync(join(ROOT, "src", "app", f), "utf8")).join("\n");
const TOKEN = generateUnsubscribeToken();
const ADDRESS = "Synthetic Co, 1 Test Street";

const confirm = (email = "person@example.test") => renderUnsubscribeHtml({ kind: "confirm", email, token: TOKEN }, ADDRESS);
const done = (email = "person@example.test") => renderUnsubscribeHtml({ kind: "done", email }, ADDRESS);
const invalid = () => renderUnsubscribeHtml({ kind: "invalid" });

test("every class the unsubscribe pages use exists in the design system", () => {
  const used = new Set<string>();
  for (const html of [confirm(), done(), invalid()]) for (const m of html.matchAll(/class="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) used.add(c);
  assert.ok(used.size > 0);
  const missing = [...used].filter((c) => !new RegExp(`\\.${c}\\b`).test(css));
  assert.deepEqual(missing, []);
});

test("the confirmation form POSTs to the unsubscribe route and carries the token", () => {
  const html = confirm();
  assert.match(html, /<form[^>]*method="post"[^>]*action="\/api\/unsubscribe"|<form[^>]*action="\/api\/unsubscribe"[^>]*method="post"/);
  assert.match(html, new RegExp(`<input type="hidden" name="t" value="${TOKEN}"`));
  assert.match(html, /<button class="btn btn-primary btn-block" type="submit">Yes, unsubscribe me<\/button>/);
});

test("the confirmation and done screens name the address and show the recipient's postal address", () => {
  assert.match(confirm(), /person@example\.test/);
  assert.match(confirm(), /Unsubscribe\?/);
  assert.match(done(), /You&#39;re unsubscribed|You're unsubscribed/);
  assert.match(done(), /person@example\.test/);
  for (const html of [confirm(), done()]) assert.match(html, /<p class="help center mt-md">Synthetic Co, 1 Test Street<\/p>/);
});

test("with no postal address the line is left out, not filled with another country's", () => {
  assert.doesNotMatch(renderUnsubscribeHtml({ kind: "confirm", email: "p@example.test", token: TOKEN }), /help center mt-md/);
});

test("the invalid page is generic: it names no address and does not say why", () => {
  const html = invalid();
  assert.match(html, /This link is no longer valid/);
  assert.doesNotMatch(html, /@|<form|token/i);
});

test("the address and the token are escaped, so a hostile value cannot inject markup", () => {
  const hostile = `"><script>alert(1)</script>@example.test`;
  const html = confirm(hostile);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&#60;script&#62;/);
  const forged = renderUnsubscribeHtml({ kind: "confirm", email: "p@example.test", token: `"><img src=x>` }, ADDRESS);
  assert.doesNotMatch(forged, /<img/);
  assert.doesNotMatch(renderUnsubscribeHtml({ kind: "done", email: "p@example.test" }, `<b>${ADDRESS}`), /<b>/);
});

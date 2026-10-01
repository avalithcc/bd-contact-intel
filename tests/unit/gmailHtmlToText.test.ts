/**
 * Unit tests for src/lib/gmail/htmlToText.ts (fresh-review fix, 2026-09-30:
 * do not store HTML at all — convert an HTML-only body to plain text
 * instead of trying to sanitize it).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { htmlToPlainText } from "@/lib/gmail/htmlToText";

test("strips tags and keeps text content", () => {
  assert.equal(htmlToPlainText("<p>Hello <b>world</b></p>"), "Hello world");
});

test("converts <br> and block-level closing tags to line breaks", () => {
  assert.equal(htmlToPlainText("Line one<br>Line two<p>Paragraph</p>Trailing"), "Line one\nLine two\nParagraph\nTrailing");
});

test("decodes common named and numeric HTML entities", () => {
  assert.equal(htmlToPlainText("Tom &amp; Jerry &lt;3 &#65;&#x42;"), "Tom & Jerry <3 AB");
});

test("removes script/style blocks entirely, including their text content", () => {
  const html = "<script>alert(document.cookie)</script><style>body{color:red}</style>Safe text";
  assert.equal(htmlToPlainText(html), "Safe text");
});

test("unquoted event handlers never survive — the whole tag and its attributes are dropped, not filtered", () => {
  const html = '<img src=x onerror=alert(1)>after';
  assert.equal(htmlToPlainText(html), "after");
  assert.doesNotMatch(htmlToPlainText(html), /onerror|alert/);
});

test("javascript: URIs never survive — the anchor tag is stripped, only its text content remains", () => {
  const html = '<a href="javascript:alert(1)">click me</a>';
  assert.equal(htmlToPlainText(html), "click me");
  assert.doesNotMatch(htmlToPlainText(html), /javascript:/);
});

test("an <svg onload=...> payload is stripped along with every other tag", () => {
  const html = "<svg onload=alert(1)>hi</svg>";
  assert.equal(htmlToPlainText(html), "hi");
  assert.doesNotMatch(htmlToPlainText(html), /onload|alert/);
});

test("out-of-range and surrogate numeric entities become U+FFFD instead of throwing (shared decodeEntities)", () => {
  assert.equal(htmlToPlainText("a&#x110000;b&#xD800;c"), "a�b�c");
  assert.equal(htmlToPlainText("&#x1F600;"), "😀");
});

test("collapses runs of blank lines and trims surrounding whitespace", () => {
  assert.equal(htmlToPlainText("<p>one</p>\n\n\n<p>two</p>   "), "one\n\ntwo");
});

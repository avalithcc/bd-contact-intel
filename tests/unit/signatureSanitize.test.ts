import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeSignatureHtml as s } from "../../src/lib/signature/sanitize";

// Every case asserts the OUTPUT string, never that a function was called.

test("keeps a realistic table-layout signature intact", () => {
  const html =
    '<table cellpadding="0" style="font-family:Arial,sans-serif;font-size:12px;color:#333333">' +
    '<tr><td><img src="https://cdn.example.com/logo.png" width="80" alt="Logo"></td>' +
    '<td><strong>Ana Pérez</strong><br><span style="color:rgb(10,20,30)">BD Lead</span><br>' +
    '<a href="https://avalith.net" style="color:#0a66c2;text-decoration:none">avalith.net</a> | ' +
    '<a href="mailto:ana@avalith.net">ana@avalith.net</a></td></tr></table>';
  const out = s(html);
  for (const needle of [
    "<table",
    "<tr>",
    "<td>",
    'src="https://cdn.example.com/logo.png"',
    'href="https://avalith.net"',
    'href="mailto:ana@avalith.net"',
    "<strong>Ana Pérez</strong>",
    "<br />",
    "font-family:Arial,sans-serif",
    "color:rgb(10,20,30)",
  ]) {
    assert.ok(out.includes(needle), `missing ${needle} in ${out}`);
  }
});

test("keeps p, div, b, em, i", () => {
  const out = s("<div><p><b>a</b> <em>b</em> <i>c</i></p></div>");
  assert.equal(out, "<div><p><b>a</b> <em>b</em> <i>c</i></p></div>");
});

test("strips <script> in lower, upper and mixed case, with its content", () => {
  for (const tag of ["script", "SCRIPT", "ScRiPt"]) {
    const out = s(`ok<${tag}>alert(1)</${tag}>done`);
    assert.equal(out, "okdone");
  }
});

test("neutralises the nested-tag trick <scr<script>ipt>", () => {
  const out = s("<scr<script>ipt>alert(1)</scr</script>ipt>");
  assert.doesNotMatch(out, /<\s*script/i);
  assert.doesNotMatch(out, /<scr/i);
  assert.doesNotMatch(out, /<[^>]*alert/i);
});

test("removes onerror from an <img> but keeps the image", () => {
  const out = s('<img src="https://x.test/a.png" onerror="alert(1)">');
  assert.doesNotMatch(out, /onerror/i);
  assert.match(out, /<img src="https:\/\/x\.test\/a\.png"/);
});

test("removes onload and every other on* handler, whatever the case", () => {
  const out = s('<div onload="x()" ONCLICK="y()" onMouseOver=z()><span OnFocus="q()">t</span></div>');
  assert.equal(out, "<div><span>t</span></div>");
});

test("drops javascript: hrefs: plain, mixed case, leading whitespace and newlines, entity-obfuscated", () => {
  const hrefs = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "   javascript:alert(1)",
    "\n\t javascript:alert(1)",
    "java\nscript:alert(1)",
    "jav&#x09;ascript:alert(1)",
    "&#106;avascript:alert(1)",
  ];
  for (const href of hrefs) {
    const out = s(`<a href="${href}">click</a>`);
    assert.doesNotMatch(out, /href/i, `kept href for ${JSON.stringify(href)}: ${out}`);
    assert.doesNotMatch(out, /javascript/i);
    assert.match(out, /click/);
  }
});

test("drops data: hrefs, including data:text/html", () => {
  for (const href of ["data:text/html,<script>alert(1)</script>", "DATA:text/html;base64,PHNjcmlwdD4="]) {
    const out = s(`<a href="${href}">x</a>`);
    assert.equal(out, "<a>x</a>");
  }
});

test("drops data:, http: and javascript: image sources; only https stays", () => {
  assert.equal(s('<img src="data:image/png;base64,AAAA">'), "");
  assert.equal(s('<img src="javascript:alert(1)">'), "");
  assert.equal(s('<img src="http://x.test/a.png">'), "");
  assert.match(s('<img src="https://x.test/a.png">'), /^<img src="https:\/\/x\.test\/a\.png" \/>$/);
});

test("removes a <style> block together with its content", () => {
  const out = s("<style>body{display:none}</style><p>hi</p>");
  assert.equal(out, "<p>hi</p>");
});

test("removes iframe, object, embed, form, input, link, meta, base", () => {
  const html =
    '<iframe src="https://evil.test"></iframe><object data="x"></object><embed src="x">' +
    '<form action="https://evil.test"><input name="a"><button>go</button></form>' +
    '<link rel="stylesheet" href="https://evil.test/a.css"><meta http-equiv="refresh" content="0;url=https://evil.test"><base href="https://evil.test">';
  const out = s(html);
  assert.doesNotMatch(out, /<(iframe|object|embed|form|input|button|link|meta|base)/i);
  assert.doesNotMatch(out, /evil\.test/);
});

test("does not leak <head>/<title> text of a pasted full document", () => {
  const out = s("<html><head><title>Secret title</title></head><body><p>sig</p></body></html>");
  assert.equal(out, "<p>sig</p>");
});

test("closes an unclosed tag instead of leaking markup", () => {
  assert.equal(s("<div><p>text"), "<div><p>text</p></div>");
  const out = s('<b>bold <a href="https://x.test');
  assert.doesNotMatch(out, /<a[^>]*$/);
  assert.match(out, /^<b>bold/);
  assert.match(out, /<\/b>$/);
});

test("an <a href> containing CR/LF/TAB comes out without any control character", () => {
  const out = s('<a href="https://x.test/\r\nBcc: victim@x.test">x</a>');
  assert.doesNotMatch(out, /[\r\n\t\0]/);
});

test("CR/LF cannot be smuggled through the entity form either", () => {
  const out = s('<a href="https://x.test/&#13;&#10;Bcc: v@x.test">x</a>');
  assert.doesNotMatch(out, /[\r\n\0]/);
});

test("inline style: keeps safe properties, drops position, url(), expression(), behavior", () => {
  const out = s(
    '<div style="color:#333;position:fixed;top:0;background-image:url(https://x.test/p.gif);width:expression(alert(1));behavior:url(x.htc);font-size:12px">t</div>',
  );
  assert.equal(out, '<div style="color:#333;font-size:12px">t</div>');
});

test("inline style: a safe property with an unsafe value is dropped, not the whole attribute", () => {
  const cases = [
    "color:url(javascript:alert(1))",
    "color:expression(alert(1))",
    "font-family:Arial;color:\\75rl(x)",
    "color:red;width:calc(100% - var(--x))",
  ];
  for (const style of cases) {
    const out = s(`<span style="${style}">t</span>`);
    assert.doesNotMatch(out, /url|expression|calc|var\(|javascript|\\/i, out);
  }
  assert.equal(s('<span style="font-family:Arial;color:expression(1)">t</span>'), '<span style="font-family:Arial">t</span>');
});

test("drops 1x1 and 0x0 tracking pixels", () => {
  assert.equal(s('<img src="https://t.test/p.gif" width="1" height="1">'), "");
  assert.equal(s('<img src="https://t.test/p.gif" width="0" height="0">'), "");
  assert.equal(s('<img src="https://t.test/p.gif" height="1">'), "");
  assert.match(s('<img src="https://t.test/logo.png" width="120" height="40">'), /<img/);
});

test("is idempotent: sanitizing the output changes nothing", () => {
  const html =
    '<table><tr><td><a href="https://a.test/?x=1&amp;y=2" style="color:#000">a &amp; b</a><img src="https://a.test/l.png" alt="l"></td></tr></table>';
  const once = s(html);
  assert.equal(s(once), once);
});

test("empty / whitespace-only input yields an empty string", () => {
  assert.equal(s(""), "");
  assert.equal(s("   \n "), "");
});

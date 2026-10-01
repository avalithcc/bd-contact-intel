/**
 * Byte-level tests for the outgoing MIME message (src/lib/gmail/rawMessage.ts).
 * Every case decodes the generated `raw` value back the way a mail client
 * would (base64url -> headers/parts -> per-part base64) and asserts on the
 * decoded result, not on a grep of the encoded string.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRawMessage, generateBoundary, wrapBase64 } from "@/lib/gmail/rawMessage";
import { htmlToOutboundText } from "@/lib/gmail/outboundText";
import { GmailSendError } from "@/lib/gmail/errors";

interface DecodedPart {
  headers: Record<string, string>;
  rawBody: string;
  text: string;
}

function parseEntity(entity: string): DecodedPart {
  const idx = entity.indexOf("\r\n\r\n");
  assert.notEqual(idx, -1, "entity must separate headers from body with CRLF CRLF");
  const headers: Record<string, string> = {};
  for (const line of entity.slice(0, idx).split("\r\n")) {
    const colon = line.indexOf(":");
    headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
  }
  const rawBody = entity.slice(idx + 4);
  return { headers, rawBody, text: Buffer.from(rawBody.replace(/\r\n/g, ""), "base64").toString("utf8") };
}

function decodeSubject(value: string): string {
  const m = /^=\?UTF-8\?B\?(.+)\?=$/.exec(value);
  assert.ok(m, "subject must be an RFC 2047 base64 encoded-word");
  return Buffer.from(m[1], "base64").toString("utf8");
}

function decode(raw: string) {
  assert.match(raw, /^[A-Za-z0-9_-]+$/, "raw must be base64url without padding or newlines");
  const message = Buffer.from(raw, "base64url").toString("utf8");
  const top = parseEntity(message);
  const parts: DecodedPart[] = [];
  let boundary: string | undefined;
  const ct = top.headers["content-type"];
  const bm = /boundary="([^"]+)"/.exec(ct);
  if (bm) {
    boundary = bm[1];
    const body = top.rawBody;
    assert.ok(body.startsWith(`--${boundary}\r\n`), "body starts with the opening delimiter");
    assert.ok(body.endsWith(`\r\n--${boundary}--\r\n`), "body ends with the closing delimiter + CRLF");
    const inner = body.slice(0, body.length - `--${boundary}--\r\n`.length);
    for (const chunk of inner.split(`--${boundary}\r\n`).slice(1)) {
      assert.ok(chunk.endsWith("\r\n"), "each part ends with CRLF before the next delimiter");
      parts.push(parseEntity(chunk.slice(0, -2)));
    }
  }
  return { message, top, parts, boundary };
}

const FROM = "bd@avalith.net";
const TO = "lead@example.com";

test("text-only input stays a single-part text/plain message", () => {
  const d = decode(buildRawMessage(FROM, TO, "Hola", { body: "Hello\nWorld" }));
  assert.equal(d.top.headers["content-type"], 'text/plain; charset="UTF-8"');
  assert.equal(d.top.headers["content-transfer-encoding"], "base64");
  assert.equal(d.top.headers["mime-version"], "1.0");
  assert.equal(d.boundary, undefined);
  assert.equal(d.parts.length, 0);
  assert.equal(d.top.text, "Hello\r\nWorld");
  assert.equal(d.top.headers.from, FROM);
  assert.equal(d.top.headers.to, TO);
});

test("text+HTML produces multipart/alternative with plain first and HTML last", () => {
  const html = "<p>Hi <b>there</b></p>";
  const d = decode(buildRawMessage(FROM, TO, "S", { bodyHtml: html }));
  assert.match(d.top.headers["content-type"], /^multipart\/alternative; boundary="[^"]+"$/);
  assert.equal(d.parts.length, 2);
  assert.equal(d.parts[0].headers["content-type"], 'text/plain; charset="UTF-8"');
  assert.equal(d.parts[1].headers["content-type"], 'text/html; charset="UTF-8"');
  for (const p of d.parts) assert.equal(p.headers["content-transfer-encoding"], "base64");
  assert.equal(d.parts[0].text, "Hi there");
  assert.equal(d.parts[1].text, html);
});

test("every line of the message uses CRLF (no bare LF or CR)", () => {
  const { message } = decode(buildRawMessage(FROM, TO, "S", { bodyHtml: "<p>a</p><p>b</p>" }));
  assert.equal(message.replace(/\r\n/g, "").match(/[\r\n]/), null);
});

test("the boundary does not occur in either decoded part nor in the encoded parts", () => {
  const html = "<p>x</p>";
  const d = decode(buildRawMessage(FROM, TO, "S", { bodyHtml: html }));
  for (const p of d.parts) {
    assert.ok(!p.text.includes(d.boundary!));
    assert.ok(!p.rawBody.includes(d.boundary!));
  }
});

test("a colliding boundary candidate is rejected and regenerated", () => {
  const candidates = ["aaa", "bbb"];
  let i = 0;
  const b = generateBoundary(["contains =_bd_aaa inside"], () => candidates[i++]);
  assert.ok(b.endsWith("bbb"));
  assert.throws(() => generateBoundary(["=_bd_same"], () => "same"), /boundary/);
});

test("html that mentions the delimiter syntax cannot break the structure", () => {
  const seq = ["x", "y"];
  let n = 0;
  const d = decode(buildRawMessage(FROM, TO, "S", { bodyHtml: "<p>--=_bd_x--</p>" }, () => seq[n++]));
  // First candidate "=_bd_x" collides with the html -> the second is used; structure still parses.
  assert.equal(d.boundary, "=_bd_y");
  assert.equal(d.parts.length, 2);
  assert.equal(d.parts[1].text, "<p>--=_bd_x--</p>");
});

test("base64 lines are at most 76 characters in every part", () => {
  const long = "<p>" + "ñandú ".repeat(400) + "</p>";
  const cases: Parameters<typeof buildRawMessage>[3][] = [{ body: "x".repeat(5000) }, { bodyHtml: long }];
  for (const content of cases) {
    const d = decode(buildRawMessage(FROM, TO, "S", content));
    const bodies = d.parts.length ? d.parts.map((p) => p.rawBody) : [d.top.rawBody];
    for (const b of bodies) {
      const lines = b.split("\r\n");
      assert.ok(lines.length > 1);
      for (const line of lines) assert.ok(line.length <= 76, `line of ${line.length} chars`);
    }
  }
});

test("wrapBase64 handles empty input and exact multiples of 76", () => {
  assert.equal(wrapBase64(""), "");
  assert.equal(wrapBase64("a".repeat(76)), "a".repeat(76));
  assert.equal(wrapBase64("a".repeat(77)), `${"a".repeat(76)}\r\na`);
});

test("a UTF-8 subject with accents round-trips through RFC 2047", () => {
  for (const content of [{ body: "x" }, { bodyHtml: "<p>x</p>" }] as const) {
    const d = decode(buildRawMessage(FROM, TO, "Propuesta técnica — reunión ñandú", content));
    assert.equal(decodeSubject(d.top.headers.subject), "Propuesta técnica — reunión ñandú");
  }
});

test("a UTF-8 body with accents and emoji round-trips (text and html)", () => {
  const text = "Hola José, ¿cómo estás? 🚀 日本語";
  const t = decode(buildRawMessage(FROM, TO, "S", { body: text }));
  assert.equal(t.top.text, text);
  const html = "<p>Hola José, ¿cómo estás? 🚀 日本語</p>";
  const h = decode(buildRawMessage(FROM, TO, "S", { bodyHtml: html }));
  assert.equal(h.parts[0].text, text);
  assert.equal(h.parts[1].text, html);
});

test("the plain part is derived from the html, not supplied separately", () => {
  const d = decode(buildRawMessage(FROM, TO, "S", { bodyHtml: '<p>See <a href="https://x.io/a?b=1&amp;c=2">our site</a></p>' }));
  assert.equal(d.parts[0].text, "See our site <https://x.io/a?b=1&c=2>");
  assert.match(d.parts[1].text, /href="https:\/\/x\.io\/a\?b=1&amp;c=2"/);
});

test("building twice with the same input is deterministic apart from the boundary", () => {
  const input = { bodyHtml: "<p>same</p>" } as const;
  const a = decode(buildRawMessage(FROM, TO, "S", input, () => "fixed"));
  const b = decode(buildRawMessage(FROM, TO, "S", input, () => "fixed"));
  assert.equal(a.message, b.message);
  assert.deepEqual(input, { bodyHtml: "<p>same</p>" });
});

// ---- Header-injection guard (To / From are interpolated raw) ----

const CONTENTS = [{ body: "x" }, { bodyHtml: "<p>x</p>" }] as const;
const BAD_VALUES: [string, string][] = [
  ["CR", "a@x.com\rb"],
  ["LF", "a@x.com\nb"],
  ["CRLF", "a@x.com\r\nb"],
  ["NUL", "a@x.com\0b"],
  ["Bcc payload", "victim@x.com\r\nBcc: evil@x.com"],
];

for (const [name, bad] of BAD_VALUES) {
  for (const field of ["to", "from"] as const) {
    test(`header guard: ${name} in ${field} throws invalid_header and produces no message`, () => {
      for (const content of CONTENTS) {
        let produced: string | undefined;
        assert.throws(
          () => {
            produced = buildRawMessage(field === "from" ? bad : FROM, field === "to" ? bad : TO, "S", content);
          },
          (err: unknown) => err instanceof GmailSendError && err.kind === "invalid_header",
        );
        assert.equal(produced, undefined);
      }
    });
  }
}

test("header guard: a normal address, and a display-name form, still work", () => {
  for (const addr of ["lead@example.com", '"Doe, Jane" <jane@example.com>']) {
    const d = decode(buildRawMessage(addr, addr, "S", { body: "x" }));
    assert.equal(d.top.headers.to, addr);
    assert.equal(d.top.headers.from, addr);
  }
});

test("header guard: a subject with CRLF is neutralised by base64, not rejected", () => {
  const subject = "Hi\r\nBcc: evil@x.com";
  const d = decode(buildRawMessage(FROM, TO, subject, { body: "x" }));
  assert.equal(decodeSubject(d.top.headers.subject), subject);
  assert.equal(d.top.headers.bcc, undefined);
  assert.match(d.top.headers.subject, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
});

// ---- Hidden content must not leak into the text/plain alternative ----

const hiddenCases: [string, string, string][] = [
  ["display:none span", '<span style="display:none">SECRET</span>visible', "visible"],
  ["display: none with spaces and caps", '<span style="color:red; DISPLAY : NONE ;">SECRET</span>visible', "visible"],
  ["visibility:hidden", "<span style='visibility:hidden'>SECRET</span>visible", "visible"],
  ["hidden div", '<div style="display:none">SECRET</div><div>visible</div>', "visible"],
  ["hidden attribute", "<p hidden>SECRET</p><p>visible</p>", "visible"],
  ["hidden attribute with value", '<span hidden="until-found">SECRET</span>visible', "visible"],
  ["unquoted style", "<div style=display:none>SECRET</div>visible", "visible"],
  [
    "nested visible child inside a hidden parent stays hidden",
    '<div style="display:none"><p>SECRET</p><span style="display:block">ALSO SECRET</span></div>visible',
    "visible",
  ],
  [
    "nested same-name elements: only the matching close ends the hidden block",
    '<div style="display:none"><div>a</div><div>b</div>SECRET</div>visible',
    "visible",
  ],
  ["hidden void element is dropped without swallowing what follows", '<img hidden src=x>visible', "visible"],
  ["visible siblings and children are kept", '<div><span style="display:none">S</span><b>kept</b></div>', "kept"],
  ["data-hidden attribute does not hide", '<span data-hidden="1">shown</span>', "shown"],
  ["the word display:none in visible text is not a style", "<p>use display:none to hide</p>", "use display:none to hide"],
  ["style value containing 'hidden' elsewhere does not hide", '<span style="color:hidden-ish">shown</span>', "shown"],
];
for (const [name, html, expected] of hiddenCases) {
  test(`hidden content: ${name}`, () => {
    assert.equal(htmlToOutboundText(html), expected);
  });
}

test("hidden content: the plain part of a built message omits it while the HTML part keeps it", () => {
  const html = '<span style="display:none">SECRET preheader</span><p>Hello</p>';
  const d = decode(buildRawMessage(FROM, TO, "S", { bodyHtml: html }));
  assert.equal(d.parts[0].text, "Hello");
  assert.equal(d.parts[1].text, html);
});

// ---- Entities must never throw on author HTML ----

const entityCases: [string, string, string][] = [
  ["above U+10FFFF (hex)", "a&#x110000;b", "a�b"],
  ["above U+10FFFF (decimal)", "a&#1114112;b", "a�b"],
  ["absurdly long numeric entity", "a&#x" + "F".repeat(400) + ";b", "a�b"],
  ["high surrogate", "a&#xD800;b", "a�b"],
  ["low surrogate", "a&#xDFFF;b", "a�b"],
  ["NUL", "a&#0;b", "a�b"],
  ["valid astral character still decodes", "&#x1F600;", "😀"],
  ["last valid code point", "&#x10FFFF;", "\u{10FFFF}"],
  ["just below the surrogate range", "&#xD7FF;", "퟿"],
];
for (const [name, html, expected] of entityCases) {
  test(`entities: ${name}`, () => {
    assert.equal(htmlToOutboundText(html), expected);
  });
}

test("entities: an out-of-range entity does not break building a message", () => {
  const d = decode(buildRawMessage(FROM, TO, "S", { bodyHtml: "<p>x&#x110000;y</p>" }));
  assert.equal(d.parts[0].text, "x�y");
});

const textCases: [string, string, string][] = [
  ["links become text <url>", '<a href="https://a.com/x">Site</a>', "Site <https://a.com/x>"],
  ["link whose label is the url is not duplicated", '<a href="https://a.com">https://a.com</a>', "https://a.com"],
  ["mailto link shows the address", '<a href="mailto:a@b.com">Mail me</a>', "Mail me <mailto:a@b.com>"],
  ["javascript: href keeps only the label", '<a href="javascript:alert(1)">Click</a>', "Click"],
  ["unordered list", "<ul><li>One</li><li>Two</li></ul>", "- One\n- Two"],
  ["br becomes a newline", "a<br>b<br/>c", "a\nb\nc"],
  ["paragraphs are separated by a blank line", "<p>One</p><p>Two</p>", "One\n\nTwo"],
  ["div becomes a line break", "<div>One</div><div>Two</div>", "One\nTwo"],
  ["entities are decoded", "Tom &amp; Jerry &lt;3 &#65;&#x42;&nbsp;&quot;q&quot;", 'Tom & Jerry <3 AB "q"'],
  ["source whitespace is collapsed", "<p>\n   a\n   b  </p>", "a b"],
  ["script, style and comments are removed", "<style>p{}</style><!-- c --><script>x()</script>ok", "ok"],
  ["unknown tags are stripped", "<span style=\"color:red\">hi</span><img src=x>", "hi"],
];
for (const [name, html, expected] of textCases) {
  test(`html to text: ${name}`, () => {
    assert.equal(htmlToOutboundText(html), expected);
  });
}

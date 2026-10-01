import { test } from "node:test";
import assert from "node:assert/strict";
import { composeEmailBody } from "../../src/lib/signature/compose";
import { buildRawMessage } from "../../src/lib/gmail/rawMessage";

const SIG = '<table><tr><td><strong>Ana Pérez</strong><br><a href="https://avalith.net">avalith.net</a></td></tr></table>';

test("no signature: the body is returned exactly as today (plain text shape)", () => {
  for (const sig of [null, undefined, "", "  \n "]) {
    assert.deepEqual(composeEmailBody("Hola,\n\nTexto", sig), { body: "Hola,\n\nTexto" });
  }
});

test("with a signature: HTML body = escaped text, blank-line boundary, then the signature", () => {
  const r = composeEmailBody("Hola,\n\nTexto", SIG);
  assert.equal(r.body, undefined);
  assert.equal(
    r.bodyHtml,
    "<div>Hola,<br><br>Texto</div><br><div>" + '<table><tr><td><strong>Ana Pérez</strong><br />' + '<a href="https://avalith.net">avalith.net</a></td></tr></table></div>',
  );
});

test("the typed body is escaped: a pasted tag cannot become markup", () => {
  const r = composeEmailBody('<script>alert(1)</script> & "q" <b>x</b>', SIG);
  assert.ok(r.bodyHtml);
  assert.doesNotMatch(r.bodyHtml, /<script/i);
  assert.doesNotMatch(r.bodyHtml, /<b>x/);
  assert.ok(r.bodyHtml.includes("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot; &lt;b&gt;x&lt;/b&gt;"));
});

test("CRLF and CR line endings in the typed body become <br>", () => {
  const r = composeEmailBody("a\r\nb\rc", SIG);
  assert.ok(r.bodyHtml?.startsWith("<div>a<br>b<br>c</div>"));
});

test("a stored signature is sanitized AGAIN at send (defence in depth)", () => {
  const evil = '<p onclick="x()">Ana</p><script>alert(1)</script><a href="javascript:alert(1)">l</a>';
  const r = composeEmailBody("hola", evil);
  assert.ok(r.bodyHtml);
  assert.doesNotMatch(r.bodyHtml, /onclick|<script|javascript:/i);
  assert.ok(r.bodyHtml.endsWith("<p>Ana</p><a>l</a></div>"));
});

test("a signature that sanitizes to nothing is treated as no signature", () => {
  assert.deepEqual(composeEmailBody("hola", "<script>alert(1)</script>"), { body: "hola" });
});

function mime(from: string, to: string, subject: string, content: Parameters<typeof buildRawMessage>[3]): string {
  return Buffer.from(buildRawMessage(from, to, subject, content), "base64url").toString("utf8");
}

function decodeParts(raw: string): { text: string; html: string } {
  const parts = [...raw.matchAll(/Content-Type: text\/(plain|html); charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)(?:\r\n--|$)/g)];
  const get = (kind: string) => {
    const m = parts.find((p) => p[1] === kind);
    return m ? Buffer.from(m[2].replace(/\r\n/g, ""), "base64").toString("utf8") : "";
  };
  return { text: get("plain"), html: get("html") };
}

test("end to end: the MIME message carries both parts, body first and signature last", () => {
  const raw = mime("ana@avalith.net", "cli@x.test", "Asunto", composeEmailBody("Hola,\n\nTexto", SIG));
  assert.match(raw, /Content-Type: multipart\/alternative/);
  const { text, html } = decodeParts(raw);
  assert.ok(html.includes("Hola,<br><br>Texto"));
  assert.ok(html.indexOf("Texto") < html.indexOf("Ana Pérez"));
  assert.ok(text.indexOf("Texto") < text.indexOf("Ana Pérez"));
  assert.ok(text.includes("avalith.net"));
  assert.doesNotMatch(text, /<\/?(div|br|table|tr|td|strong|a)[\s>\/]/i);
});

test("end to end without a signature: still single-part text/plain, unchanged", () => {
  const raw = mime("ana@avalith.net", "cli@x.test", "Asunto", composeEmailBody("Hola", null));
  assert.doesNotMatch(raw, /multipart/);
  assert.match(raw, /Content-Type: text\/plain; charset="UTF-8"/);
});

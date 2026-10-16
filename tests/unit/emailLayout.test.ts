import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emailButton,
  emailCallout,
  emailFacts,
  emailFallbackLink,
  emailPill,
  emailSteps,
  escapeHtml,
  renderEmail,
  renderEmailText,
} from "@/lib/mailer/emailLayout";

const base = { subject: "S", preheader: "Vista previa", eyebrow: "Aviso", title: "Título", bodyHtml: "<p>cuerpo</p>", reason: "Motivo", replies: false };

test("the document is the approved frame: 600px table, light scheme, wordmark, red-rule card, preheader, no images", () => {
  const html = renderEmail(base);
  assert.match(html, /<meta name="color-scheme" content="light">/);
  assert.match(html, /width="600"/);
  assert.match(html, />avalith<span style="color:#d5252f;">\.<\/span>/);
  assert.match(html, /border-top:4px solid #d5252f/);
  assert.match(html, /display:none;[^>]*>Vista previa/);
  assert.match(html, /\/\/ Aviso/);
  assert.match(html, /<h1[^>]*>Título<\/h1>/);
  assert.doesNotMatch(html, /<img/i);
  assert.doesNotMatch(html, /rgba\(/, "borders are solid hex");
});

test("subject, eyebrow, title, preheader and reason are escaped", () => {
  const evil = `<script>"x"&'y'`;
  const html = renderEmail({ ...base, subject: evil, eyebrow: evil, title: evil, preheader: evil, reason: evil });
  assert.doesNotMatch(html, /<script>/);
  assert.equal(html.split("&lt;script&gt;").length - 1, 5);
});

test("footer: replies flag switches between the no-reply and the admin-reply sentence", () => {
  assert.match(renderEmail(base), /no recibe respuestas/);
  assert.match(renderEmail({ ...base, replies: true }), /tu respuesta llega a la administración/);
  assert.match(renderEmail(base), /notificaciones@avalith\.net/);
});

test("button: href and label land in both the VML and the link, escaped", () => {
  const html = emailButton(`Ir <ya>`, `https://x.test/a?b=1&c="2"`);
  assert.equal(html.split(`href="https://x.test/a?b=1&amp;c=&quot;2&quot;"`).length - 1, 2);
  assert.match(html, /v:roundrect/);
  assert.doesNotMatch(html, /<ya>/);
});

test("fallback link, callout, steps, facts and pill escape their text arguments", () => {
  assert.doesNotMatch(emailFallbackLink(`"><i>`), /"><i>/);
  assert.doesNotMatch(emailCallout("info", "<b>t</b>", "x"), /<b>t<\/b>/);
  assert.doesNotMatch(emailSteps([["<b>", "<i>"]]), /<b>|<i>/);
  assert.doesNotMatch(emailFacts([["<k>", "v"]]), /<k>/);
  assert.doesNotMatch(emailPill("<p>", "warn"), /<p>/);
});

test("the text twin appends the same reason and footer as the HTML", () => {
  const text = renderEmailText({ body: "Hola\nhttps://x.test/go", reason: "Motivo", replies: true });
  assert.equal(text, "Hola\nhttps://x.test/go\n\nMotivo\nMensaje automático de Avalith CRM, enviado desde notificaciones@avalith.net. Podés responder este correo: tu respuesta llega a la administración del CRM.\n");
  assert.equal(escapeHtml(`'`), "&#39;");
});

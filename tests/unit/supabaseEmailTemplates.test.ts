import assert from "node:assert/strict";
import { test } from "node:test";
import { buildInviteTemplate, buildRecoveryTemplate } from "@/lib/mailer/supabaseTemplates";

const CASES = [
  { name: "recovery", build: buildRecoveryTemplate, type: "recovery", subject: "Restablecé tu contraseña de Avalith CRM", button: "Restablecer contraseña" },
  { name: "invite", build: buildInviteTemplate, type: "invite", subject: "Te damos la bienvenida a Avalith CRM", button: "Crear mi contraseña" },
] as const;

for (const c of CASES) {
  test(`${c.name}: the link keeps the exact token_hash shape (HTML-escaped ampersand) in the button, VML and fallback`, () => {
    const { html, subject } = c.build();
    assert.equal(subject, c.subject);
    const href = `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=${c.type}`;
    assert.equal(html.split(`href="${href}"`).length - 1, 3, "VML, button and fallback anchor");
    assert.ok(html.includes(`>${href}</a>`), "visible fallback text");
    assert.ok(html.includes(`>${c.button}</a>`));
    assert.doesNotMatch(html, /ConfirmationURL/);
  });

  test(`${c.name}: only Go-template actions Supabase provides, all balanced, none broken by escaping`, () => {
    const { html } = c.build();
    const actions = [...html.matchAll(/\{\{([^}]*)\}\}/g)].map((m) => m[1].trim());
    assert.ok(actions.length > 0);
    assert.ok(actions.every((a) => [".SiteURL", ".TokenHash", ".Email"].includes(a)), actions.join(","));
    assert.equal((html.match(/\{\{/g) ?? []).length, (html.match(/\}\}/g) ?? []).length);
    assert.doesNotMatch(html, /&#123;|&lbrace;|&amp;#123;/);
    assert.match(html, /<meta name="color-scheme" content="light">/);
    assert.match(html, /display:none;[^>]*>[^<]+/, "preheader");
  });
}

/**
 * The extension card's pure parts: text cleaning for what is read from the profile, the state to view-model
 * mapping (copy from the approved mockup) and the stylesheet that reuses the CRM's design tokens.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { cleanName, cleanText, companyFromLabel } from "../../extension/src/content/profileText";
import { buildCardView, formatActivity, type CardState } from "../../extension/src/content/viewModel";
import { extractCardCss } from "../../extension/build/extractCardCss";

// ---- text cleaning -------------------------------------------------------------------------------------------

test("whitespace, zero-width characters and duplicated screen-reader text are cleaned", () => {
  assert.equal(cleanText("  Directora \n de   Producto​ "), "Directora de Producto");
  assert.equal(cleanText("Despegar Despegar"), "Despegar", "a value doubled by hidden accessible text");
  assert.equal(cleanText("Ana PérezAna Pérez"), "Ana Pérez");
  assert.equal(cleanText("Ana Ana"), "Ana Ana", "too short to be treated as doubled text");
  assert.equal(cleanText(""), "");
  assert.equal(cleanText(null), "");
});

test("the name loses the connection degree and a trailing pronoun note but keeps credentials for the CRM rule", () => {
  assert.equal(cleanName("Camila Herrera · 2º"), "Camila Herrera");
  assert.equal(cleanName("Camila Herrera · 3rd"), "Camila Herrera");
  assert.equal(cleanName("Camila Herrera (ella/she)"), "Camila Herrera");
  assert.equal(cleanName("Ana Pérez, MBA"), "Ana Pérez, MBA", "the stuffed suffix is the CRM's job, not the extension's");
});

test("the current company comes from the top-card label in Spanish, English or Portuguese", () => {
  assert.equal(companyFromLabel("Empresa actual: Despegar. Haz clic para ir a la sección de experiencia"), "Despegar");
  assert.equal(companyFromLabel("Current company: Mercado Libre. Click to skip to experience card"), "Mercado Libre");
  assert.equal(companyFromLabel("Empresa atual: Nubank. Clique para ir para a seção de experiência"), "Nubank");
  assert.equal(companyFromLabel("Educación: Universidad de Buenos Aires"), null);
  assert.equal(companyFromLabel(""), null);
});

// ---- state to view model -------------------------------------------------------------------------------------

const FOUND: CardState = {
  kind: "found",
  personId: "0b8e1f10-0000-4000-8000-000000000001",
  name: "Valentina Rojas",
  jobTitle: "VP de Ingeniería",
  company: "Mercado Libre",
  ownerName: "Ana Pereyra",
  lastActivity: { label: "Llamada", date: "2026-10-15T14:00:00.000Z" },
};

test("found: badge, identity, owner, last activity and the open-record action", () => {
  const view = buildCardView(FOUND);
  assert.equal(view.badge?.text, "En el CRM");
  assert.equal(view.badge?.tone, "success");
  assert.equal(view.pill.dot, "success");
  assert.equal(view.pill.label, "En el CRM");
  assert.equal(view.pill.ariaLabel, "Abrir tarjeta del CRM: Valentina Rojas está en el CRM");
  assert.equal(view.busy, false);
  assert.equal(view.body.kind, "found");
  if (view.body.kind !== "found") return;
  assert.equal(view.body.initials, "VR");
  assert.equal(view.body.subtitle, "VP de Ingeniería · Mercado Libre");
  assert.equal(view.body.ownerName, "Ana Pereyra");
  assert.equal(view.body.ownerInitials, "AP");
  assert.equal(view.body.lastActivity, "15 oct 2026 · Llamada");
  assert.equal(view.body.actionLabel, "Ver en el CRM");
  assert.equal(view.body.help, "Se abre la ficha en una pestaña nueva.");
});

test("found with gaps shows only what exists, never a placeholder person", () => {
  const view = buildCardView({ ...FOUND, jobTitle: null, company: null, ownerName: null, lastActivity: null });
  assert.equal(view.body.kind, "found");
  if (view.body.kind !== "found") return;
  assert.equal(view.body.subtitle, "");
  assert.equal(view.body.ownerName, null);
  assert.equal(view.body.lastActivity, null);
});

test("not found offers to add and says what will be read", () => {
  const view = buildCardView({ kind: "not_found" });
  assert.equal(view.badge, null);
  assert.equal(view.pill.dot, "neutral");
  assert.equal(view.pill.label, "No está en el CRM");
  assert.deepEqual(view.body, {
    kind: "not_found",
    badge: "No está en el CRM",
    message: "Esta persona aún no existe en el CRM.",
    actionLabel: "Agregar al CRM",
    help: "Lee nombre, cargo y empresa de este perfil y abre “Nuevo contacto” precargado, en una pestaña nueva. No se guarda nada hasta que lo revises.",
  });
});

test("loading is busy with a status message and no action", () => {
  const view = buildCardView({ kind: "loading" });
  assert.equal(view.busy, true);
  assert.deepEqual(view.body, { kind: "loading", message: "Buscando en el CRM…" });
  assert.equal(view.pill.dot, null);
});

test("signed out and error carry their message and action", () => {
  const out = buildCardView({ kind: "signed_out" });
  assert.deepEqual(out.body, {
    kind: "signed_out",
    message: "Inicia sesión en el CRM para ver si esta persona ya existe.",
    actionLabel: "Iniciar sesión",
    help: "Abre el inicio de sesión del CRM en una pestaña nueva.",
  });
  const err = buildCardView({ kind: "error" });
  assert.deepEqual(err.body, {
    kind: "error",
    message: "No pudimos consultar el CRM. Revisa tu conexión e inténtalo de nuevo.",
    actionLabel: "Reintentar",
  });
});

test("activity dates are shown in Argentina time as day, month and year", () => {
  assert.equal(formatActivity({ label: "Contacto creado", date: "2026-10-18T02:30:00.000Z" }), "17 oct 2026 · Contacto creado");
});

// ---- stylesheet reuses the CRM design system ------------------------------------------------------------------

const root = path.resolve(__dirname, "../..");
const globals = readFileSync(path.join(root, "src/app/globals.css"), "utf8");
const designSystem = readFileSync(path.join(root, "src/app/design-system.css"), "utf8");

test("the card stylesheet carries the CRM tokens and the design-system component rules, scoped to the shadow host", () => {
  const css = extractCardCss(globals, designSystem);
  assert.match(css, /:host\s*{[^}]*--color-accent:\s*#d5252f/);
  assert.match(css, /--space-sm:\s*0\.5rem/);
  assert.match(css, /\.btn-primary\s*{[^}]*background:\s*var\(--color-accent\)/);
  assert.match(css, /\.badge-success\s*{/);
  assert.match(css, /\.alert-info\s*{/);
  assert.match(css, /\.avatar\.a1\s*{/);
  assert.match(css, /\.owner-chip\s*{/);
  assert.match(css, /@keyframes ds-spin/);
  assert.doesNotMatch(css, /:root/);
  assert.doesNotMatch(css, /\.sidebar|\.topbar|\.overlay/, "app chrome rules are not copied");
  assert.doesNotMatch(css, /@media/, "media-query blocks are skipped, the card is desktop-only");
});

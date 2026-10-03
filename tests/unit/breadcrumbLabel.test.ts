import test from "node:test";
import assert from "node:assert/strict";
import { BREADCRUMB_ROUTE_PREFIXES, resolveBreadcrumbKey } from "@/lib/shell/breadcrumbLabel";

test("names each section instead of falling back to Contactos", () => {
  // Owner report 2026-10-03: every one of these announced itself as
  // "Contactos", because NAVIGATION never held them — the Sidebar's "Guías"
  // and "Administración" sections are hardcoded JSX.
  assert.equal(resolveBreadcrumbKey("/admin/duplicates"), "duplicates");
  assert.equal(resolveBreadcrumbKey("/admin/reports"), "reports");
  assert.equal(resolveBreadcrumbKey("/admin/audit-log"), "auditLog");
  assert.equal(resolveBreadcrumbKey("/admin/migration"), "migration");
  assert.equal(resolveBreadcrumbKey("/admin/rfc-backfill"), "rfcBackfill");
  assert.equal(resolveBreadcrumbKey("/playbook"), "playbook");
  assert.equal(resolveBreadcrumbKey("/contact-status"), "contactStatusGuide");
});

test("keeps the sections that already worked", () => {
  assert.equal(resolveBreadcrumbKey("/contacts"), "leads");
  assert.equal(resolveBreadcrumbKey("/contacts/abc-123"), "leads");
  assert.equal(resolveBreadcrumbKey("/companies"), "companies");
  assert.equal(resolveBreadcrumbKey("/companies/acme"), "companies");
  assert.equal(resolveBreadcrumbKey("/tasks"), "tasks");
  assert.equal(resolveBreadcrumbKey("/follow-ups"), "followUps");
  assert.equal(resolveBreadcrumbKey("/hiring"), "hiring");
  assert.equal(resolveBreadcrumbKey("/whats-new"), "whatsNew");
  assert.equal(resolveBreadcrumbKey("/discovery"), "discovery");
  assert.equal(resolveBreadcrumbKey("/account"), "account");
  assert.equal(resolveBreadcrumbKey("/account/linkedin-messages"), "account");
  // "/" is the legacy contacts home (title: "base de contactos"), so Contactos
  // is its real name here, not the old catch-all fallback.
  assert.equal(resolveBreadcrumbKey("/"), "leads");
});

test("a prefix only matches a whole segment", () => {
  // `/contacts` must not swallow `/contact-status`, which is what a bare
  // startsWith would do and is why the order of the list alone is not enough.
  assert.equal(resolveBreadcrumbKey("/contact-status"), "contactStatusGuide");
  // `/admin/reports` must win over a shorter `/admin` entry if one is added.
  assert.equal(resolveBreadcrumbKey("/admin/reports"), "reports");
});

test("an unknown route gets no breadcrumb rather than the wrong one", () => {
  // Naming some other section is worse than naming none: that is the bug
  // being fixed, not a style preference.
  assert.equal(resolveBreadcrumbKey("/something-new"), null);
  assert.equal(resolveBreadcrumbKey("/admin"), null);
});

test("every sidebar destination has a breadcrumb — the drift guard", () => {
  // The whole bug was two places knowing different things. These are the
  // routes the Sidebar links to (NAVIGATION plus its hardcoded "Guías" and
  // "Administración" sections, read from Sidebar.tsx on 2026-10-03). Adding a
  // sidebar link without an entry in breadcrumbLabel.ts fails here instead of
  // silently showing "Contactos" in production.
  const sidebarDestinations = [
    "/contacts",
    "/companies",
    "/tasks",
    "/follow-ups",
    "/hiring",
    "/whats-new",
    "/discovery",
    "/playbook",
    "/contact-status",
    "/admin/reports",
    "/admin/duplicates",
    "/admin/audit-log",
    "/account",
  ];
  for (const href of sidebarDestinations) {
    assert.notEqual(resolveBreadcrumbKey(href), null, `${href} is linked in the sidebar but has no breadcrumb`);
  }
  for (const href of sidebarDestinations) {
    assert.ok(
      BREADCRUMB_ROUTE_PREFIXES.includes(href),
      `${href} resolves only by a looser prefix; give it its own entry`,
    );
  }
});

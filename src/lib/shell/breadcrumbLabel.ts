/**
 * Route -> breadcrumb label key for the app-shell header (TopBar.tsx).
 *
 * Owner report (2026-10-03): "en el header queda un label referenciando a
 * Contactos en todas las vistas". `breadcrumbFor` used to search the sidebar's
 * `NAVIGATION` list and fall back to `contactsFallback` for anything it did
 * not find — so /admin/duplicates, /playbook, /contact-status and the admin
 * tools all announced themselves as "Contactos".
 *
 * The root cause is that the Sidebar knows about more routes than NAVIGATION
 * holds: its "Guías" and "Administración" sections are hardcoded JSX, invisible
 * to anything reading NAVIGATION. Two places that must agree, and only one of
 * them knew. This module is now the single list, and
 * `tests/unit/breadcrumbLabel.test.ts` fails if a NAVIGATION href ever lacks an
 * entry here — so the two cannot drift apart again.
 *
 * Pure (no React, no dictionary) so it is unit-testable without rendering the
 * client component, same convention as `topBarSearchTarget.ts`.
 *
 * Returns a label KEY, not a label: the caller owns the dictionary. `null`
 * means "no breadcrumb" — deliberately preferred over naming some other
 * section, because a wrong breadcrumb is worse than none.
 */
import type { NavLabels } from "@/lib/i18n/navLabels";

export type BreadcrumbKey = keyof NavLabels;

/**
 * Longest prefix first: `/admin/reports` must win over any shorter `/admin`
 * entry, and `/contacts` must not swallow `/contact-status`.
 */
const ROUTE_LABELS: ReadonlyArray<readonly [string, BreadcrumbKey]> = [
  ["/admin/absorptions", "absorptions"],
  ["/admin/audit-log", "auditLog"],
  ["/admin/duplicates", "duplicates"],
  ["/admin/migration", "migration"],
  ["/admin/rfc-backfill", "rfcBackfill"],
  ["/admin/reports", "reports"],
  ["/account", "account"],
  ["/contact-status", "contactStatusGuide"],
  ["/playbook", "playbook"],
  ["/follow-ups", "followUps"],
  ["/companies", "companies"],
  ["/contacts", "leads"],
  ["/discovery", "discovery"],
  ["/whats-new", "whatsNew"],
  ["/hiring", "hiring"],
  ["/tasks", "tasks"],
  // "/" is the legacy contacts home (its own title is "base de contactos"), so
  // "Contactos" is its real name, not the old fallback. Safe anywhere in this
  // list: the matcher needs an exact hit or a `/`-delimited segment, and no
  // real path starts with "//".
  ["/", "leads"],
];

export function resolveBreadcrumbKey(pathname: string): BreadcrumbKey | null {
  const hit = ROUTE_LABELS.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return hit ? hit[1] : null;
}

/** Every prefix this module claims — the drift test reads it. */
export const BREADCRUMB_ROUTE_PREFIXES: ReadonlyArray<string> = ROUTE_LABELS.map(([prefix]) => prefix);

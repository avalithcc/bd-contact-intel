/**
 * App-shell header search (TopBar.tsx) — owner report (2026-09-30): "no
 * tengo buscador de empresas, solo está el de contactos. Aunque entre a
 * Empresas, en el header sigue apareciendo el buscador de contactos."
 *
 * Pure route -> search-target resolution, split out of TopBar.tsx so it's
 * unit-testable without rendering the client component.
 *
 * Owner report (2026-10-03): "el buscador en el header de contactos está en
 * todas las vistas, recién entré a admin y lo vi… solo debería estar en la
 * sección de contactos." The rule used to be
 * `startsWith("/companies") ? "companies" : "contacts"`, so EVERY other route
 * — /admin, /tasks, /follow-ups, /reports, /playbook — showed a contacts
 * search box, and submitting it navigated the user out of the section they
 * were working in. The target is now NULL on those routes and TopBar renders
 * no form at all; `.topbar-actions` has `margin-left: auto`, so the header
 * layout is unaffected by its absence.
 *
 * `/contact/[id]` (singular) is the legacy record redirect, kept on the
 * contacts side so the box does not blink out during the hop to
 * `/contacts/[id]`.
 */
export type TopBarSearchTarget = "contacts" | "companies";

export function resolveTopBarSearchTarget(pathname: string): TopBarSearchTarget | null {
  if (pathname.startsWith("/companies")) return "companies";
  if (pathname.startsWith("/contacts") || pathname.startsWith("/contact/")) return "contacts";
  return null;
}

/** `/contacts` or `/companies` — the path `TopBar`'s search form submits to. */
export function topBarSearchBasePath(target: TopBarSearchTarget): string {
  return `/${target}`;
}

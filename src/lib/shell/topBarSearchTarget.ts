/**
 * App-shell header search (TopBar.tsx) — owner report (2026-09-30): "no
 * tengo buscador de empresas, solo está el de contactos. Aunque entre a
 * Empresas, en el header sigue apareciendo el buscador de contactos."
 *
 * Pure route -> search-target resolution, split out of TopBar.tsx so it's
 * unit-testable without rendering the client component. `/companies*`
 * (the record page `/companies/[key]` included) resolves to "companies";
 * everything else keeps the pre-existing "contacts" behavior.
 */
export type TopBarSearchTarget = "contacts" | "companies";

export function resolveTopBarSearchTarget(pathname: string): TopBarSearchTarget {
  return pathname.startsWith("/companies") ? "companies" : "contacts";
}

/** `/contacts` or `/companies` — the path `TopBar`'s search form submits to. */
export function topBarSearchBasePath(target: TopBarSearchTarget): string {
  return `/${target}`;
}

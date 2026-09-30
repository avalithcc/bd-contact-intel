"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./TopBar.module.css";
import { NAVIGATION } from "./Sidebar";
import type { NavLabels } from "@/lib/i18n/navLabels";
import type { TopBarSearchLabels } from "@/lib/i18n/topBarSearchLabels";
import { resolveTopBarSearchTarget, topBarSearchBasePath } from "@/lib/shell/topBarSearchTarget";
import { DropdownMenu } from "@/components/DropdownMenu";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { ChevronDownIcon, AccountIcon } from "@/components/icons";
import { SignOutButton } from "../SignOutButton";
import type { Locale } from "@/lib/i18n/locales";

/** Reads the current `?q=` straight off `window.location.search` — not
 * `useSearchParams()`, which would force this always-mounted shell
 * component into the Suspense-boundary dance (same tradeoff
 * BulkResultToast.tsx's own doc comment already documents for this exact
 * hook). SSR-safe: returns "" on the server, then corrects itself once the
 * effect below runs client-side. */
function readCurrentSearchTerm(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("q") ?? "";
}

function breadcrumbFor(pathname: string, labels: NavLabels): string {
  // /account, /account/email — not in the sidenav NAVIGATION list (they're
  // reached from the account menu, not a nav item), so they'd otherwise
  // fall through to the contacts fallback below (tasks.md mockup-parity
  // 5.1 fix; mockups/account.html and account-email.html both show
  // "Cuenta" as the single-level breadcrumb here).
  if (pathname.startsWith("/account")) return labels.account;

  const item = NAVIGATION.flatMap((section) => section.items).find((i) =>
    pathname.startsWith(i.href),
  );
  // "/" is the legacy pre-Phase-12 contacts home, kept as a separate,
  // still-bdId-scoped page (task 11.7 SUGGESTION) — /contacts (task 12.2)
  // is the new unified list this breadcrumb/search now points at.
  return item ? labels[item.labelKey] : labels.contactsFallback;
}

/**
 * App shell top bar (design.md D9, Phase 8; account menu added in tasks.md
 * mockup-parity 3.1/3.2 — see below for the "Crear" menu it shipped
 * alongside, later removed).
 *
 * Search is context-aware (owner report 2026-09-30: "no tengo buscador de
 * empresas, solo está el de contactos. Aunque entre a Empresas, en el
 * header sigue apareciendo el buscador de contactos"). It used to be
 * contacts-only unconditionally (owner decision, tasks.md 8.2); it now
 * resolves its target from the current route
 * (`resolveTopBarSearchTarget`, src/lib/shell/topBarSearchTarget.ts):
 * `/companies*` submits to `/companies?q=…` (getCompanyListPage's search
 * condition, src/lib/companies/searchCondition.ts), everywhere else keeps
 * submitting to `/contacts?q=…` (getContactListPage's search condition,
 * src/lib/contacts/listQueries.ts) — same `q` param either page already
 * reads.
 *
 * The mockup's "Crear" menu (contacts.html:40-47, design-system.html) lists
 * Contacto/Tarea/Nota en un contacto/Importar contactos. It shipped here
 * with only that last item wired up (the other three had no real flow to
 * link to yet — see the removed history of this comment). Once
 * NewContactDialog and the "Nueva tarea" dialog landed, the menu was never
 * revisited: it sat next to the page's own "Nuevo contacto" button holding
 * a single link, which read as a redundant one-item dropdown.
 *
 * Owner decision (2026-09-28): drop the "Crear" menu entirely — "ese botón
 * de crear no tiene sentido, no lo implementemos." This is a deliberate
 * divergence from the approved mockup, not an oversight; do not restore it
 * in a future mockup-parity pass. "Importar contactos" — the only working
 * link the menu held — moved to the `/contacts` page's own toolbar, next
 * to "Nuevo contacto" (see `src/app/(app)/contacts/page.tsx`), since a
 * contacts-scoped import belongs on that page rather than in the global
 * shell.
 *
 * mockup-port 02: markup now uses design-system.css's global classes
 * (`.topbar`, `.breadcrumbs`, `.search`, `.topbar-actions`, `.btn`,
 * `.menu-item`, etc.) matching contacts.html 1:1, instead of
 * TopBar.module.css. The DropdownMenu component itself (focus management,
 * Escape/outside-click, aria-haspopup/aria-expanded) is unchanged — only
 * its `triggerClassName` and the classes on its children are now the
 * mockup's global vocabulary. TopBar.module.css is kept, scoped down to
 * just the sign-out button's width/alignment override — the static mockup
 * has no equivalent for a full-width button inside a menu (it only shows a
 * plain "Cerrar sesión" link).
 */
export function TopBar({
  labels,
  searchLabels,
  me,
  locale,
}: {
  labels: NavLabels;
  searchLabels: TopBarSearchLabels;
  me: { id: string; name: string; role: "admin" | "bd" };
  locale: Locale;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchTarget = resolveTopBarSearchTarget(pathname);
  const [q, setQ] = useState(readCurrentSearchTerm);

  // Re-seeds the box from the URL whenever the route changes — e.g.
  // switching from a `/contacts?q=acme` search to `/companies` (no `q`)
  // must not leave "acme" showing in what is now the companies search box.
  // TopBar itself never unmounts between navigations (it lives in the
  // shared app-shell layout), so this can't rely on a fresh `useState` init.
  useEffect(() => {
    setQ(readCurrentSearchTerm());
  }, [pathname]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const basePath = topBarSearchBasePath(searchTarget);
    router.push(q ? `${basePath}?q=${encodeURIComponent(q)}` : basePath);
  }

  const searchCopy =
    searchTarget === "companies"
      ? { label: searchLabels.companiesLabel, placeholder: searchLabels.companiesPlaceholder }
      : { label: searchLabels.contactsLabel, placeholder: searchLabels.contactsPlaceholder };

  const accountLabel = me.name || labels.account;
  const roleLabel = me.role === "admin" ? labels.roleAdmin : labels.roleBd;

  return (
    <header className="topbar">
      <nav className="breadcrumbs" aria-label="Ruta de navegación">
        <span>{breadcrumbFor(pathname, labels)}</span>
      </nav>
      <form className="search" onSubmit={onSubmit} role="search">
        <span className="sr-only">{searchCopy.label}</span>
        <input
          type="search"
          placeholder={searchCopy.placeholder}
          aria-label={searchCopy.label}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </form>
      <div className="topbar-actions">
        <DropdownMenu
          ariaLabel={labels.accountMenuLabel}
          triggerClassName="btn btn-ghost btn-sm"
          trigger={
            <>
              <Avatar id={me.id} initials={initialsFromName(me.name)} size="sm" />
              <ChevronDownIcon className="icon" />
            </>
          }
        >
          <div className="menu-label" role="none">
            {labels.signedInLabel}
          </div>
          <div className="menu-item" role="none">
            <span className="grow">
              <strong>{accountLabel}</strong>
              <br />
              <span className="meta">{roleLabel}</span>
            </span>
          </div>
          <div className="menu-sep" role="none" />
          <Link className="menu-item" role="menuitem" href="/account">
            <AccountIcon className="icon" />
            {labels.account}
          </Link>
          <div className={`menu-item ${styles.menuSignOut}`} role="none">
            <SignOutButton locale={locale} />
          </div>
        </DropdownMenu>
      </div>
    </header>
  );
}

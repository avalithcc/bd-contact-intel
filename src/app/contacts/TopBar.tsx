"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import styles from "./TopBar.module.css";
import { NAVIGATION } from "./Sidebar";
import type { NavLabels } from "@/lib/i18n/navLabels";
import { DropdownMenu } from "@/components/DropdownMenu";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { PlusIcon, ChevronDownIcon, ImportIcon, AccountIcon } from "@/components/icons";
import { SignOutButton } from "../SignOutButton";
import type { Locale } from "@/lib/i18n/locales";

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
 * App shell top bar (design.md D9, Phase 8; "Crear"/account menus added in
 * tasks.md mockup-parity 3.1/3.2). Search is contacts-only (owner decision,
 * tasks.md 8.2): it submits to `/contacts` (task 12.2 — this route didn't
 * exist yet when the shell shipped, so it targeted `/`), using the same `q`
 * param that page reads (getContactListPage's search condition,
 * listQueries.ts).
 *
 * The mockup's "Crear" menu (design-system.html) lists Contacto/Tarea/Nota
 * en un contacto/Importar contactos. Only "Importar contactos" links to a
 * real existing flow (`/contacts/import`) — there is no standalone
 * new-contact form, global new-task modal, or contact picker to log a note
 * against anywhere in the app yet (contacts arrive via LinkedIn
 * import/sync; tasks and notes are created from within a contact record's
 * QuickActions). Per the apply instructions ("Crear items link to existing
 * create flows only... omit if a flow doesn't exist"), those three items
 * are omitted rather than pointed at a route that doesn't exist.
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
  me,
  locale,
}: {
  labels: NavLabels;
  me: { id: string; name: string; role: "admin" | "bd" };
  locale: Locale;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [q, setQ] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    router.push(q ? `/contacts?q=${encodeURIComponent(q)}` : "/contacts");
  }

  const accountLabel = me.name || labels.account;
  const roleLabel = me.role === "admin" ? labels.roleAdmin : labels.roleBd;

  return (
    <header className="topbar">
      <nav className="breadcrumbs" aria-label="Ruta de navegación">
        <span>{breadcrumbFor(pathname, labels)}</span>
      </nav>
      <form className="search" onSubmit={onSubmit} role="search">
        <span className="sr-only">Buscar contactos</span>
        <input
          type="search"
          placeholder="Buscar contactos por nombre, empresa o correo electrónico"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </form>
      <div className="topbar-actions">
        <DropdownMenu
          triggerClassName="btn btn-primary btn-sm"
          trigger={
            <>
              <PlusIcon className="icon" />
              {labels.create}
              <ChevronDownIcon className="icon" />
            </>
          }
        >
          <Link className="menu-item" role="menuitem" href="/contacts/import">
            <ImportIcon className="icon" />
            {labels.importContacts}
          </Link>
        </DropdownMenu>

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
